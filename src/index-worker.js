importScripts("/code/data-index-db.js");
importScripts("/code/data-qtree.js");
importScripts("/code/data-moment.js");

self.onmessage = (event) => {
    if (!event.data) {
        console.log({worker_message: event});
        return;
    }
    if (event.data.type) {
        files_store.keys(files => {
            processor(files, event.data);
        });
    } else if (event.data.open) {
        open(event.data.open);
    } else {
        console.log({worker_got: event});
    }
};

let database = null;
let files_store = null;
let token_store = null;
let project_store = null;
let current_tree = null;

let util = {
    moment: moment,

    millis_to_date: function(ms) {
        let time = new Date(ms);
        let yr = time.getFullYear().toString().substring(2,4);
        let mo = (time.getMonth()+1).toString().padStart(2,0);
        let da = (time.getDate()+1).toString().padStart(2,0);
        let hh = time.getHours().toString().padStart(2,0);
        let mm = time.getMinutes().toString().padStart(2,0);
        let ss = time.getSeconds().toString().padStart(2,0);
        let tzo = time.getTimezoneOffset();
        return {yr, mo, da, hh, mm, ss, tzo};
    },

    date_to_millis: function(date) {
        let ss = 1000;
        let mm = ss * 60;
        let hh = mm * 60;
        let da = hh * 24;
        let yr = parseInt(date.yr) + 2000;
        let mo = parseInt(date.mo) - 1;
        let mos = [31, yr % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let ms = parseInt(date.ss || 0) * ss;
        ms += parseInt(date.mm || 0) * mm;
        ms += parseInt(date.hh || 0) * hh;
        ms += (parseInt(date.da) - 1) * da;
        while (mo-- > 0) {
            ms += mos[mo] * da;
        }
        while (yr-- > 1970) {
            ms += (yr % 4 === 0 ? 366 : 365) * da;
        }
        if (date.tzo) {
            ms -= parseInt(date.tzo) * mm;
        }
        return ms;
    },

    parse_csv: function(line) {
        let str = '';
        let mark = 0;
        let inside = null;
        let toks = [];
        for (let i=0; i<=line.length; i++) {
            switch (line.charAt(i)) {
                case '"':
                    if (inside === '"') {
                        str += line.substring(mark+1,i);
                        inside = null;
                    } else {
                        inside = '"';
                    }
                    mark = i;
                    break;
                case '':
                case ',':
                    if (inside) {
                        continue;
                    }
                    if (i - mark > 1) {
                        str += line.substring(mark+1,i);
                    }
                    toks.push(str);
                    mark = i;
                    str = '';
                    break;
            }
        }
        let meta = this.meta;
        if (meta.row === 0 || !meta.head) {
            meta.head = toks;
            return;
        }
        let head = meta.head;
        let map = {};
        for (let i=0; i<head.length; i++) {
            map[head[i]] = toks[i];
        }
        return map;
    },

    parse: function(line, options) {
        options = options || {
            split: ",",
            group: [ '""' ],
            header: null
        };
        let splitter = options.split || ',';
        let groups = options.group || [ '""' ];
        let str = '';
        let mark = 0;
        let inside = null;
        let toks = [];
        for (let i=0; i<=line.length; i++) {
            let char = line.charAt(i);
            if (inside) {
                for (let j=0; j<groups.length; j++) {
                    if (char === groups[j][1]) {
                        str += line.substring(mark+1,i);
                        inside = null;
                        mark = i;
                        break;
                    }
                }
            } else {
                if (char === splitter || char === '') {
                    if (i - mark > 1) {
                        str += line.substring(mark+1,i);
                    }
                    toks.push(str);
                    mark = i;
                    str = '';
                } else {
                    for (let j=0; j<groups.length; j++) {
                        if (char === groups[j][0]) {
                            inside = groups[j][0];
                            mark = i;
                            break;
                        }
                    }
                }
            }
        }
        let meta = this.meta;
        let head = options.header || meta.head;
        if (!head && meta.row === 0) {
            meta.head = toks;
            return;
        }
        let map = {};
        for (let i=0; i<head.length; i++) {
            map[head[i]] = toks[i];
        }
        return map;
    },

    meta: { }
};

function open(pid) {
    console.log({worker_open: pid});

    database = Database.open(pid);
    files_store = database.group('files');
    token_store = database.group('tokens');
    project_store = database.group('project');
    current_tree = null;

    // resurrect last tree created
    project_store.get("tree", node => {
        if (node) {
            current_tree = new Node(node);
        } else {
            current_tree = null;
        }
    });
}

function processor(files, data) {
    console.log({process: files, data})
    try {
        let time = Date.now();
        let type = data.type;
        let code = data.code;
        let fnext = 0;
        let files = data.files;
        let index = data.index;
        let count = 0;
        let samples = 0;
        let proginc = 0;
        let progress = 0;
        let cancel = false;
        let meta = {};
        let fn = null;

        if (files.length === 0) {
            postMessage({index, type, progress: 1, done: true});
            return;
        }

        let done = () => {
            cancel = true;
        };

        // clears preview window
        postMessage({type, clear: true});
        let each = 1.0 / files.length;

        // ---- TOKENIZER ----
        let next_tokens = () => {
            let file = files[fnext];
            files_store.get(file, info => {
                let output = [];
                let line = null;
                let data = info.data;
                let emit = (object) => {
                    if (samples++ < 50) {
                        postMessage({index, type, emit: object, progress});
                    } else if (proginc > 0.05) {
                        progress += proginc;
                        postMessage({index, type, progress});
                    }
                    output.push(object);
                };
                for (let i=0; i<data.length; i++) {
                    if (cancel) {
                        break;
                    }
                    proginc = (each * fnext + (i / data.length) * each) - progress;
                    line = data[i];
                    if (line) {
                        try {
                            meta.files = files;
                            meta.file = file;
                            meta.rows = data.length;
                            meta.row = i;
                            fn(line, emit, done, meta, util);
                            meta.index += 1;
                        } catch (error) {
                            console.log({ line, error });
                            // return postMessage({index, type, progress: 1, done: true, error});
                        }
                    }
                }
                token_store.put(file, output, (ok, event) => {
                    if (!ok) {
                        postMessage({index, type, progress: 1, done: true, error: event.target.error});
                        return;
                    }
                    if (++fnext === files.length) {
                        postMessage({index, type, progress: 1, done: true});
                        time = Date.now() - time,
                        console.log({tokenizer_done: fnext,
                            samples,
                            time,
                            speed: Math.round((samples/time)*1000)});
                    } else {
                        next_tokens();
                    }
                });
            });
        };

        // ---- BUILDER ----
        let tree = null;
        let next_build = () => {
            let file = files[fnext];
            token_store.get(file, tokens => {
                if (!tree) {
                    tree = new Node();
                }
                if (!tokens) {
                    console.log('no tokens, file =', file);
                    // return;
                }
                function insert() {
                    let args = [...arguments];
                    if (samples++ < 50) {
                        let path = args.join('/');
                        postMessage({index, type, emit: path, progress});
                    }
                    return tree.insert.apply(tree,args);
                }
                if (tokens && tokens.length)
                for (let i=0; i<tokens.length; i++) {
                    if (cancel) {
                        break;
                    }
                    try {
                        meta.files = files;
                        meta.file = file;
                        meta.rows = tokens.length;
                        meta.row = i;
                        fn(tokens[i], insert, done, meta, util);
                        meta.index += 1;
                    } catch (error) {
                        console.log(error, tokens[i]);
                        return postMessage({index, type, progress: 1, done: true, error});
                    }
                    proginc = (each * fnext + (i / tokens.length) * each) - progress;
                    if (proginc > 0.05) {
                        progress += proginc;
                        postMessage({index, type, progress});
                    }
                }
                if (++fnext === files.length) {
                    current_tree = tree;
                    project_store.put("tree", tree, (ok, event) => {
                        if (!ok) {
                            postMessage({index, type, progress: 1, done: true, error: event.target.error});
                        } else {
                            postMessage({index, type, progress: 1, done: true});
                        }
                    });
                } else {
                    next_build();
                }
            });
        };

        switch (type) {
            case 'tokenizer':
                try {
                    meta.index = 0;
                    fn = new Function('line,emit,done,meta,util', code);
                } catch (error) {
                    return postMessage({index, type, progress: 1, done: true, error});
                }
                return next_tokens();
            case 'builder':
                try {
                    meta.index = 0;
                    fn = new Function('tokens,insert,done,meta,util', code);
                } catch (error) {
                    return postMessage({index, type, progress: 1, done: true, error});
                }
                return next_build();
            case 'query':
                if (!current_tree) {
                    postMessage({
                        index,
                        type,
                        error: "missing tree data",
                        progress: 1,
                        done: true
                    });
                    return;
                }
                let time = Date.now();
                let res = null;
                let error = null;
                try {
                    fn = new Function('meta,query', code);
                    fn(meta, text => {
                        let cur0 = text.indexOf("{");
                        let cur1 = text.indexOf("}");
                        if (cur0 >= 0 && cur1 > cur0) {
                            text = [
                                text.substring(0,cur0),
                                meta.sub || text.substring(cur0+1,cur1),
                                text.substring(cur1+1)
                            ].join('');
                        }
                        return res = current_tree.query(text, meta);
                    });
                    res = res ? res.result() : null;
                } catch (err) {
                    error = err;
                    console.log(error);
                }
                if (res) {
                    project_store.put("query-results", res);
                }
                time = Date.now() - time;
                postMessage({index, type, emit: res, progress: 1, time, done: true, error});
                return;
            default:
                return console.log({unhandled_type: type});
        }
    } catch (e) {
        console.log({worker_error: e});
    }
}

let now = Date.now();
let date = util.millis_to_date(now);
let mill = util.date_to_millis(date);

console.log({now, mill, date, delta: (now-mill)/(1000*60*60*24) });
