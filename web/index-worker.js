importScripts("index-db.js");
importScripts("qtree.js");

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
    millis_to_date: (ms) => {
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

    date_to_millis: (date) => {
        let ss = 1000;
        let mm = ss * 60;
        let hh = mm * 60;
        let da = hh * 24;
        let yr = parseInt(date.yr) + 2000;
        let mo = parseInt(date.mo) - 1;
        let mos = [31, yr % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let ms = parseInt(date.ss) * ss;
        ms += parseInt(date.mm) * mm;
        ms += parseInt(date.hh) * hh;
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
    }
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
                            console.log(error);
                            return postMessage({index, type, progress: 1, done: true, error});
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

        let tree = null;
        let next_trees = () => {
            token_store.get(files[fnext], tokens => {
                if (!tree) {
                    tree = new Node();
                }
                function insert() {
                    let args = [...arguments];
                    if (samples++ < 50) {
                        let path = args.join('/');
                        postMessage({index, type, emit: path, progress});
                    }
                    return tree.insert.apply(tree,args);
                }
                for (let i=0; i<tokens.length; i++) {
                    if (cancel) {
                        break;
                    }
                    try {
                        fn(tokens[i], insert, done, util);
                    } catch (error) {
                        console.log(error);
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
                    next_trees();
                }
            });
        };

        switch (type) {
            case 'tokenizer':
                meta.index = 0;
                try {
                    fn = new Function('line,emit,done,meta,util', code);
                } catch (error) {
                    return postMessage({index, type, progress: 1, done: true, error});
                }
                return next_tokens();
            case 'builder':
                try {
                    fn = new Function('tokens,insert,done,util', code);
                } catch (error) {
                    return postMessage({index, type, progress: 1, done: true, error});
                }
                return next_trees();
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
                        return res = current_tree.query(text);
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
