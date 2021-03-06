window.addEventListener('DOMContentLoaded', init);

let window_size = null;
let window_track = null;
let file_limit = 10000000;
let file_list = [];
let file_workers = [];
let file_selected = null;
let files_store = null;
let token_store = null;
let project_store = null;
let storage = localStorage;
let queries = [];
let drags = {};
let sizes = {};
let alias = null;
let defaults = {
    'file-pre': "file preview",
    'token-pre': "tokens preview",
    'build-pre': "builder preview",
    'input-query-key': "query name",
    'input-project-name': "default",
    'text-query-code': "query('+/+:+count')",
    'text-tokenizer-code': [
        "// tokenizer has access to",
        "// 'line' :: string :: next file input line",
        "// 'emit' :: function(object) :: emit tokens",
        "// 'done' :: function() :: end processing",
        "// 'meta' :: object :: file, rows, row",
        "let tokens = line.split(',')",
        "emit(tokens)"
    ].join('\n'),
    'text-builder-code': [
        "// builder has access to",
        "// 'tokens' :: object :: from tokens emit()",
        "// 'insert' :: function(arg, arg, ...) :: add tree path",
        "// 'done' :: function() :: end processing",
        "insert('a/b/c')",
        "insert('d','e','f')"
    ].join('\n')
};
let edit = {
    token: undefined,
    build: undefined
};
let ondone = {};

function init() {
    bind_workers();
    alias = JSON.parse(storage.alias || "{}");
    open(storage.project || 'default');
    window.onkeydown = (ev) => {
        let listfocus = document.activeElement === $('file-list');
        if (ev.key === 'Escape') {
            modal_hide();
        } else
        if (ev.key === 'j' && (ev.metaKey || ev.ctrlKey)) {
            render_selection();
        } else
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && listfocus) {
            let files = selected_files();
            if (files.length && confirm(`delete ${files.length} files?`)) {
                console.log({ delete:selected_files() });
                function cb(ok) { console.log({ok}) }
                files.forEach(file => {
                    files_store.remove(file, cb);
                    token_store.remove(file, cb);
                    let find = file_list.indexOf(file);
                    if (find >= 0) {
                        file_list.splice(find,1);
                    }
                });
                render_file_list();
            }
        }
    };
    window.onclick = (ev) => {
        if (ev.target.id === 'token-pre') {
            let sel = window.getSelection();
            let t = sel.baseNode.wholeText;
            let r = document.createRange();
            r.setStart(sel.baseNode, 0);
            r.setEnd(sel.baseNode, t.length);
            sel.empty();
            sel.addRange(r);
            render_selection();
        }
    };
    window.onresize = (ev) => {
        return;
        clearTimeout(window_track);
        window_track = setTimeout(() => {
            if (window.innerHeight !== window_size.height) {
                if (confirm('reset window sizes?')) {
                    delete storage.sizes;
                    window.location.reload();
                }
            }
        }, 10000);
    };
    window_size = {
        width: window.innerWidth,
        height: window.innerHeight
    };
    $('modal').onclick = modal_hide;

    edit.build = ace.edit($("ace-code"), {
        mode: "ace/mode/javascript",
        theme: "ace/theme/chrome",
        selectionStyle: "text"
    });
    edit.build.session.setTabSize(2);
    edit.build.session.setUseSoftTabs(true);
}

function modal_hide() {
    $('project-impexp').style.display = 'none';
    $('project-pop').style.display = 'none';
    $('help-info').style.display = 'none';
    $('modal').style.display = 'none';
}

function help() {
    let modal = $('modal');
    let help = $('help-info');
    help.style.display = 'block';
    modal.style.display = 'block';
}

function project_export() {
    let name = $('project-name').value;
    let json = JSON.stringify({
        name: name,
        token: $('tokenizer-code').value,
        // build: $('builder-code').value,
        build: edit.build.session.getValue(),
        query: queries
    });
    let blob = new Blob([json], {type: "octet/stream"});
    let url = window.URL.createObjectURL(blob);
    let html = ['<div><div id="exp-title">',
        '<label>project export data</label><button>x</button></div>','<pre id="exp">',
        json,'</pre><div class="row"><label id="exp-res"></label>',
        '<span class="grow"></span>',
        `<button><a href="${url}" download="${name}.json">download</a></button>`,
        '</div></div>'].join('');
    let modal = $('modal');
    let impexp = $('project-impexp');
    impexp.innerHTML = html;
    impexp.style.display = 'block';
    modal.style.display = 'block';

    let range = document.createRange();
    range.selectNodeContents($('exp'));
    let sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let res = document.execCommand("copy");
    let expres = $('exp-res');
    expres.innerText = res ? "copied to clipboard" : "ctrl-c to copy to clipboard";
}

function project_import(data) {
    let val = data || prompt("paste project data", '');
    if (val) {
        try {
            let { name, token, build, query } = JSON.parse(val);
            project_new(name);
            setTimeout(() => {
                console.log({name, token, build, query});
                $('project-name').value = name;
                $('tokenizer-code').value = token;
                // $('builder-code').value = build;
                edit.build.session.setValue(build),
                queries = query;
                render_queries();
                [...document.getElementsByTagName('textarea')].forEach(area => {
                    if (area.id) save_area(area);
                });
            }, 100);
        } catch (e) {
            console.log(e);
            alert("invalid project data");
        }
    }
}

function project_load() {
    let keys = Object.keys(alias);
    if (keys.length === 0) {
        return alert('no projects saved');
    }
    let modal = $('modal');
    let pop = $('project-pop');
    let html = [`<select id="project-select" size=10>`];
    keys.forEach(pid => {
        html.push(`<option value="${pid}">${alias[pid]}</option>`)
    });
    html.push('</select>');
    pop.innerHTML = html.join('');
    pop.style.display = 'block';
    modal.style.display = 'block';
    let select = $('project-select');
    select.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        let index = select.selectedIndex;
        if (index >= 0) {
            open(select[index].value);
            modal_hide();
        }
    };
}

function project_new(newname) {
    let newproj = newname || prompt("new project name");
    if (newproj) {
        let project_id = Math.round(Math.random() * 0xffffffffffffff).toString(36);
        alias[project_id] = newproj;
        storage.alias = JSON.stringify(alias);
        open(project_id);
    }
}

function project_delete() {
    let proj_id = storage.project;
    let proj_name = alias[proj_id];
    if (!confirm(`delete project "${proj_name || proj_id}"`)) {
        return;
    }
    delete alias[proj_id];
    storage.alias = JSON.stringify(alias);
    storage.project = 'default';
    location.reload();
}

function open(project) {
    storage.project = project;
    let name = alias[project] || project;

    console.log({open: project, description: name});

    file_workers.forEach((worker,index) => {
        worker.postMessage({
            open: project
        });
    });

    let database = Database.open(project);
    files_store = database.group('files');
    token_store = database.group('tokens');
    project_store = database.group('project');

    bind_drag();
    bind_inputs();
    bind_file_list_actions();
    restore_window_contents();

    $(storage.focus || 'query-code').focus();
}

function $(id) {
    return document.getElementById(id);
}

function dims(el) {
    let css = getComputedStyle(el);
    return {
        w: parseFloat(css.width.split('px')[0]),
        h: parseFloat(css.height.split('px')[0])
    };
}

function set_width(el, dims) {
    el.style.width = `${dims.w}px`;
    el.style.minWidth = '';
    el.style.maxWidth = '';
    let size = sizes[el.id] = (sizes[el.id] || {});
    size.width = dims.w;
    storage.sizes = JSON.stringify(sizes);
}

function set_height(el, dims) {
    el.style.height = `${dims.h}px`;
    el.style.minHeight = '';
    el.style.maxHeight = '';
    let size = sizes[el.id] = (sizes[el.id] || {});
    size.height = dims.h;
    storage.sizes = JSON.stringify(sizes);
}

function restore_window_contents(name) {
    $('query-graph').innerHTML = '';

    project_store.get("queries", qlist => {
        queries = qlist || [];
        render_queries();
    });

    project_store.get("query-results", results => {
        render_query_results(results || { table:[["query output"]], meta: {} });
    });

    project_store.get("preview-file", preview => {
        $('file-pre').innerText = preview || defaults['file-pre'];
    })

    project_store.get("preview-tokens", preview => {
        $('token-pre').innerText = preview || defaults['token-pre'];
    })

    project_store.get("preview-build", preview => {
        $('build-pre').innerText = preview || defaults['build-pre'];
    })

    project_store.get("selected-file", selected => {
        file_selected = selected;
        files_store.keys(files => {
            file_list = files;
            render_file_list();
            project_store.get("selected-files", files => {
                select_files(files);
            });
        });
    });
}

function bind_drag() {
    sizes = JSON.parse(storage.sizes || "{}");
    for (let id in sizes) {
        let size = sizes[id];
        let el = $(id);
        if (size.width) {
            el.style.width = `${size.width}px`;
        }
        if (size.height) {
            el.style.height = `${size.height}px`;
        }
    }
    [...document.getElementsByClassName('drag')].forEach(drag => {
        let parent = drag.parentNode;
        let children = [...parent.childNodes].filter(c => c.tagName === 'DIV');
        let drag_index = children.indexOf(drag);
        let before = children[drag_index - 1];
        let after = children[drag_index + 1];
        let vert = [...drag.classList].indexOf('drag-vert') >= 0;
        drag.uuid_key = Math.round(Math.random() * 0xffffffffff).toString(36);
        drags[drag.uuid_key] = {
            parent,
            children,
            before,
            after,
            vert,
            bsize: dims(before),
            asize: dims(after)
        };
    });
    [...document.getElementsByClassName('drag')].forEach(drag => {
        let {
            parent,
            children,
            before,
            after,
            vert,
            bsize,
            asize
        } = drags[drag.uuid_key];
        if (vert) {
            set_height(before, bsize);
            set_height(after, asize);
        } else {
            set_width(before, bsize);
            set_width(after, asize);
        }
        drag.onmousedown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            let before_size = dims(before);
            let after_size = dims(after);
            if (vert) {
                set_height(before, before_size);
                set_height(after, after_size);
            } else {
                set_width(before, before_size);
                set_width(after, after_size);
            }
            let origin = {
                x: ev.screenX,
                y: ev.screenY
            };
            parent.onmousemove = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                let pos = {
                    x: ev.screenX,
                    y: ev.screenY
                };
                let delta = {
                    x: pos.x - origin.x,
                    y: pos.y - origin.y
                };
                if (vert) {
                    let bh = before_size.h + delta.y;
                    let ah = after_size.h - delta.y;
                    if (bh > 10 && ah > 10) {
                        set_height(before, {h: bh});
                        set_height(after, {h: ah});
                    }
                } else {
                    let bw = before_size.w + delta.x;
                    let aw = after_size.w - delta.x;
                    if (bw > 10 && aw > 10) {
                        set_width(before, {w: bw});
                        set_width(after, {w: aw});
                    }
                }
            };
            parent.onmouseup = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                parent.onmouseup = null;
                parent.onmouseout = null;
                parent.onmousemove = null;
            };
        };
    });
}

function query_do() {
    save_area($('query-code'));
}

function save_area(area) {
    project_store.put(`text-${area.id}`, area.value);
    area.blur();
    area.classList.add('flash-green');
    setTimeout(() => {
        area.classList.remove('flash-green');
        area.focus();
    },100);
    start_workers(area);
}

function bind_inputs() {
    [...document.getElementsByTagName('input')].forEach(input => {
        if (!input.id) return;
        let store_key = `input-${input.id}`;
        input.setAttribute('spellcheck','false');
        input.setAttribute('autocomplete','off');
        input.onkeydown = (event) => {
            if (event.key === 'Enter') {
                project_store.put(store_key, input.value);
                input.blur();
                input.classList.add('flash-green');
                setTimeout(() => {
                    input.classList.remove('flash-green');
                    input.focus();
                },100);
                handle_input(input.id, input.value);
            }
        };
        input.onfocus = () => {
            storage.focus = input.id;
        };
        project_store.get(store_key, value => {
            input.value = value || defaults[store_key] || `no default for ${store_key}`;
        });
    });
    let code_save;
    project_store.get('text-builder-code', value => {
        edit.build.session.setValue(value || defaults['text-builder-code'] || '');
        edit.build.commands.addCommand({
            name: 'save',
            bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
            exec: code_save = function(editor) {
                let code = edit.build.session.getValue();
                project_store.put(`text-builder-code`, code);
                start_workers({
                    id: "builder",
                    value: code
                });
            }
        });
    });
    $('token-code-save').onclick = () => {
        save_area($('tokenizer-code'));
    };
    $('build-code-save').onclick = () => {
        code_save();
    };
    [...document.getElementsByTagName('textarea')].forEach(area => {
        if (!area.id) return;
        let store_key = `text-${area.id}`;
        area.setAttribute('spellcheck','false');
        area.onfocus = () => {
            storage.focus = area.id;
        };
        area.onkeydown = (event) => {
            let meta = event.metaKey || event.ctrlKey;
            let save =
                (event.key === 's' && meta) ||
                (event.key === 'Enter' && meta);
            if (save) {
                save_area(area);
                event.preventDefault();
            } else if (event.key === 'Tab') {
                if (event.shiftKey) {
                    // outdent
                } else {
                    // handle range indent
                    let pos = area.selectionStart;
                    let val = area.value;
                    area.value = val.substring(0,pos) + '\t' + val.substring(pos);
                    area.setSelectionRange(pos+1,pos+1);
                    area.focus();
                }
                event.preventDefault();
            }
        };
        project_store.get(store_key, value => {
            area.value = value || defaults[store_key] || `no default for ${store_key}`;
        });
    });
}

function bind_workers() {
    file_workers.push(
        new Worker("/code/data-worker.js")
    );

    file_workers.forEach(worker => {
        worker.onmessage = (event) => {
            let msg = event.data;
            let div;
            switch (msg.type) {
                case 'tokenizer':
                    div = $('token-pre');
                    if (msg.clear) {
                        div.innerText = '';
                    }
                    if (msg.error) {
                        div.innerText = `!! ${msg.error} !!`;
                    }
                    if (msg.emit) {
                        div.innerText += `${JSON.stringify(msg.emit)}\n`;
                    }
                    if (msg.progress) {
                        $('token-bar').style.display = "block";
                        $('token-bar').style.width = `${msg.progress*100}%`;
                    }
                    if (msg.done) {
                        project_store.put('preview-tokens', div.innerText);
                        $('token-bar').style.display = "none";
                        if (ondone.tokenizer) {
                            let next = ondone.tokenizer;
                            ondone.tokenizer = undefined;
                            next();
                        }
                    }
                    break;
                case 'builder':
                    div = $('build-pre');
                    if (msg.clear) {
                        div.innerText = '';
                    }
                    if (msg.error) {
                        div.innerText = `!! ${msg.error} !!`;
                    }
                    if (msg.emit) {
                        div.innerText += `${JSON.stringify(msg.emit)}\n`;
                    }
                    if (msg.progress) {
                        $('build-bar').style.display = "block";
                        $('build-bar').style.width = `${msg.progress*100}%`;
                    }
                    if (msg.done) {
                        project_store.put('preview-build', div.innerText);
                        $('build-bar').style.display = "none";
                        if (ondone.builder) {
                            let next = ondone.builder;
                            ondone.builder = undefined;
                            next();
                        }
                    }
                    break;
                case 'query':
                    if (msg.clear) {
                        $('query-out').innerText = '';
                    }
                    if (msg.emit && msg.emit.table) {
                        render_query_results(msg.emit);
                        // query_save();
                        if (msg.time) {
                            console.log({query_rows: msg.emit.table.length, time_ms: msg.time});
                        }
                    }
                    if (msg.error) {
                        $('query-out').innerText = `!! ${msg.error} !!`;
                    }
                    break;
                default:
                    console.log({worker_sed: event});
                    break;
            }
        };
    });
}

function query_select(qi) {
    project_store.put('input-query-key', queries[qi].key);
    project_store.put('text-query-code', queries[qi].code);
    $('query-key').value = queries[qi].key;
    $('query-code').value = queries[qi].code;
    start_workers($('query-code'));
    $('query-code').focus();
}

function query_delete(qi, ev) {
    ev.preventDefault();
    ev.stopPropagation();
    queries.splice(qi,1);
    render_queries();
}

function query_save() {
    let query = {
        key: $('query-key').value,
        code: $('query-code').value
    };
    let match = false;
    for (let i=0; i<queries.length; i++) {
        let replace = (
            queries[i].key === query.key ||
            (query.code === queries[i].code && !query.key)
        );
        if (replace) {
            queries[i] = query;
            match = true;
            break;
        }
    }
    if (!match) {
        queries.push(query);
    }
    render_queries();
}

function render_query_results(results) {
    let table = results.table;
    let meta = results.meta || {};
    let header = meta.header;
    let footer = meta.footer;
    let keycol = meta.keycol || [];

    let rowbegin = 0;
    let rowend = table.length;
    if (header) {
        rowbegin++;
    }
    if (footer) {
        rowend--;
    }
    let vals = [].concat.apply(0,table.filter((r,ri) => (ri >= rowbegin && ri < rowend)).map((r,ri) => {
        return r
            .map((cv,ci) => {
                return keycol.indexOf(ci) < 0 ? cv : undefined
            });
    }));
    let vmax = Math.max.apply(0,vals.map(v => v === undefined ? -Infinity : v));
    let vmin = Math.min.apply(0,vals.map(v => v === undefined ? Infinity : v));
    let vdelta = vmax - vmin;
    let heat = meta.heat;

    let chain = [];

    if (meta.chain) {
        meta.chain.forEach(el => {
            for (let [query, col] of Object.entries(el)) {
                chain[col] = query;
            }
        });
    }

    let html = ['<table>'];
    if (table)
    table.forEach((row,ri) => {
        if (!row) {
            return;
        }
        html.push(`<tr>`);
        row.forEach((cell,ci) => {
            if (cell === undefined) {
                cell = '';
            }
            let type =
                (header && ri === 0) ||
                (footer && ri === table.length -1) ||
                keycol.indexOf(ci) >= 0
                ? 'th' : 'td';
            let pct = cell === '' ? 0 : (cell-vmin) / vdelta;
            let text = pct < 0.7 ? "black" : "white";
            let title = ` title="${cell}"`;
            if (heat === 2 && type === 'td') cell = '';
            let style = heat && type === 'td' ?
                ` style="color:${text};background-color:rgba(100,100,100,${pct})"` : '';
            if (cell && meta.fixed) {
                try { cell = cell.toFixed(meta.fixed) } catch (e) { }
            }
            if (cell && chain[ci]) {
                cell = `<a class="chain" onclick="chain('${chain[ci]}','${cell}')">${cell}</a>`;
            }
            html.push(`<${type}${title}${style}>${cell}</${type}>`);
        });
        html.push(`</tr>`);
    });
    html.push('</table>');

    $('query-out').innerHTML = html.join('');
    let qout = $('query-output');
    qout.scrollTop = qout.scrollHeight;

    // graphing
    if (meta.graph) {
        let labelcol = meta.keycol ? meta.keycol[0] : undefined;
        let valcol = undefined;
        let period = 0;
        meta.graph.forEach((v,i) => {
            switch (typeof(v)) {
                case 'number':
                    valcol = v;
                    break;
                case 'object':
                    labelcol = v.label || labelcol;
                    period = v.period || period;
                    break;
            }
        });
        let max = Math.max.apply(0,table.map((r,i) => {
            let val = r[valcol] || 0;
            return (i >= rowbegin && i < rowend) ? val : -Infinity
        }));
        let html = [''];
        for (let i=rowbegin; i<rowend; i++) {
            let cval = table[i][valcol];
            let pval = Math.round((cval / max) * 100);
            let lval = labelcol >= 0 ? table[i][labelcol] : '';
            let label = `<label>${lval}&nbsp;<i>${cval}</i></label>`;
            html.push(`<div title="${lval} = ${cval}" style="height:${pval}%">${label}</div>`);
            if (period && (i-begin) % period === period - 1 && i !== end-1) {
                html.push('<span></span>');
            }
        }

        let qgx = $('query-graph');
        qgx.innerHTML = html.join('');
        qgx.scrollLeft = qgx.scrollWidth;
    } else {
        $('query-graph').innerHTML = '';
    }
}

function render_queries() {
    let html = ['<table>'];
    if (queries.length) {
        let sorted = queries.sort((a,b) => {
            return a.key < b.key ? -1 : 1;
        });
        sorted.forEach((query,qi) => {
            html.push(`<tr onclick="query_select(${qi})">`);
            html.push(`<th>${query.key}</th><td>${query.code}</td>`);
            html.push(`<td width=100%></td><td><button onclick="query_delete(${qi},event)">x</button></td`);
            html.push(`</tr>`)
        });
    } else {
        html.push("<tr><td>query history</td></tr>");
    }
    html.push('</table>');
    $('query-history').innerHTML = html.join('');
    project_store.put("queries", queries);
}

function render_file_list() {
    let list = $('file-list');
    let html = [];
    file_list
        .sort((a,b) => {
            return a < b ? -1 : 1;
        })
        .forEach(name => {
            html.push(`<option value="${name}">${name}</option>`);
        });
    if (html.length > 0) {
        list.innerHTML = html.join('');
    } else {
        list.innerHTML = "<option>file-drop</option>";
    }
    // force scroll to end of list
    list.selectedIndex = file_list.length - 1;
    list.selectedIndex = -1;
    select_files([file_selected]);
}

function render_selection() {
    let sel = window.getSelection().baseNode.wholeText;
    if (sel) {
        let obj = sel.charAt(0) === '{' && sel.charAt(sel.length-1) === '}';
        let arr = sel.charAt(0) === '[' && sel.charAt(sel.length-1) === ']';
        try {
            if (obj || arr) {
                $('query-out').innerHTML = `<pre>${JSON.stringify(JSON.parse(sel),null,2)}</pre>`;
            }
        } catch (e) {
            console.log(e);
        }
    }
}

function read_file(file, ondone, onprogress) {
    let reader = new FileReader();
    reader.onprogress = onprogress;
    reader.onloadend = ondone;
    reader.readAsBinaryString(file);
}

function bind_file_list_actions() {
    let proj_name = $('project-name');

    proj_name.addEventListener("dragover", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        proj_name.classList.add("bg-dragover");
    });

    proj_name.addEventListener("dragleave", (evt) => {
        proj_name.classList.remove("bg-dragover");
    });

    proj_name.addEventListener("drop", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        proj_name.classList.remove("bg-dragover");
        let file = evt.dataTransfer.files[0];
        if (file && confirm(`import project file "${file.name}"?`)) {
            read_file(file, (ev) => {
                project_import(ev.target.result);
            });
        }
    });

    let files = $('files');

    files.addEventListener("dragover", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        files.classList.add("bg-dragover");
    });

    files.addEventListener("dragleave", (evt) => {
        files.classList.remove("bg-dragover");
    });

    files.addEventListener("drop", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();

        files.classList.remove("bg-dragover");

        let xfiles = evt.dataTransfer.files;
        let readidx = 0;
        let readlen = xfiles.length;
        let readdata = null;
        let readfile = null;
        let progeach = 1/readlen;
        let progress = 0;
        let errors = [];
        let loaded = [];
        let selected = selected_files();

        let set_bar = (pct) => {
            $('file-bar').style.display = pct ? "block" : "none";
            $('file-bar').style.width = `${pct * 100}%`;
        };

        let load_next = () => {
            readfile = xfiles[readidx++];
            let reader = new FileReader();
            reader.onprogress = (ev) => {
                let pct = ev.loaded / ev.total;
                set_bar(progress + progeach/2 * pct);
            };
            reader.onloadend = (ev) => {
                set_bar(progress += progeach/2);
                readdata = ev.target.result;
                // let status bar update before possibly
                // blocking main loop with big split op
                setTimeout(load_done, 0);
            };
            reader.readAsBinaryString(readfile);
        };

        let load_done = () => {
            let file = readfile;
            let name = file.name;
            if (readdata.length === 0) {
                errors.push(`no data returned for "${name}". may be too large (${file.size})`);
                return check_more_files();
            }
            let splitter = '\n';
            if (readdata.indexOf('\r\n') >= 0) {
                splitter = '\r\n';
            } else if (readdata.indexOf('\r') >= 0) {
                splitter = '\r';
            }
            let data = readdata.split(splitter);
            let bytes_per_row = Math.ceil(file.size / data.length);
            let rows_per_file = Math.floor(file_limit / bytes_per_row);
            let chunk_count = Math.ceil(data.length / rows_per_file);

            // console.log({bytes_per_row, rows_per_file, rows: data.length, chunk_count});

            let chunks = [ data ];

            // break into chunks if needed
            if (chunk_count > 1) {
                let chunkstart = 0;
                let newchunks = [];
                for (let i=0; i<chunk_count; i++) {
                    newchunks.push(data.slice(chunkstart, chunkstart + rows_per_file));
                    chunkstart += rows_per_file;
                }
                chunks = newchunks;
            }

            let progchunk = progeach / 2 / chunk_count;

            let save_chunk = (count) => {
                set_bar(progress += progchunk);
                let file_name = name;
                let file_data = chunks[count];
                if (chunks.length > 1) {
                    file_name = `${name}-${count.toString().padStart(2,'0')}`;
                }
                if (file_list.indexOf(file_name) < 0) {
                    file_list.push(file_name);
                }
                files_store.put(file_name, {file, data: file_data}, (ok, error) => {
                    // console.log({put:file_name, len:file_data.length, ok, error});
                    if (ok) {
                        loaded.push(file_name);
                        if (count < chunks.length - 1) {
                            save_chunk(count + 1);
                        } else {
                            check_more_files();
                        }
                    } else {
                        console.log({error});
                    }
                });
            };

            save_chunk(0);
        };

        let check_more_files = () => {
            if (--readlen === 0) {
                set_bar(0);
                render_file_list();
                if (evt.shiftKey) {
                    start_workers($('tokenizer-code'), loaded);
                    select_files(selected);
                    select_files(loaded);
                    project_store.put("selected-files", selected_files());
                    ondone.tokenizer = () => {
                        // start_workers($('builder-code'));
                        start_workers({
                            id: "builder",
                            value: edit.build.session.getValue()
                        });
                    };
                    ondone.builder = () => {
                        start_workers($('query-code'));
                    };
                }
                if (errors.length > 0) {
                    $('file-pre').innerText = errors.join('\n');
                }
            } else {
                load_next();
            }
        };

        load_next();
    });

    let list = $('file-list');

    list.onclick = (ev) => {
        let index = list.selectedIndex;
        if (!list[index]) {
            return;
        }
        let value = list[index].value;
        files_store.get(value, (info) => {
            if (!info) return;
            let preview = info.data.slice(0,100).join('\n');
            $('file-pre').innerHTML = preview;
            file_selected = value;
            project_store.put("preview-file", preview);
            project_store.put("selected-file", file_selected);
        });
        project_store.put("selected-files", selected_files());
    };
}

function handle_input(id, value) {
    switch (id) {
        case 'project-name':
            alias[storage.project] = value;
            storage.alias = JSON.stringify(alias);
            break;
    }
}

function select_files(files) {
    if (!files) return;
    let list = $('file-list');
    [...list.options].forEach(opt => {
        if (files.indexOf(opt.value) >= 0) {
            opt.selected = true;
        }
    });
}

function selected_files() {
    let files = [];
    let list = $('file-list');
    [...list.options].forEach(opt => {
        if (opt.selected) {
            files.push(opt.value);
        }
    });
    return files;
}

function chain(qname, sub) {
    queries.forEach(query => {
        if (query.key === qname) {
            let code = query.code;
            if (sub) {
                code = [`meta.sub="${sub}"`,code].join('\n');
            }
            start_workers(undefined, undefined, code);
        }
    });
}

function start_workers(area, flist, dircode) {
    let files = flist || selected_files();
    let type = area ? area.id.split('-')[0] : 'query';
    let code = area ? area.value : dircode || 'no-code';
    switch (type) {
        case 'tokenizer':
            send_worker_jobs(type, code, files, file_workers);
            break;
        case 'builder':
            send_worker_jobs(type, code, files, [ file_workers[0] ]);
            break;
        case 'query':
            send_worker_jobs(type, code, [42], [ file_workers[0] ]);
            break;
        default:
            console.log({unhandled_area: area, type});
    }
}

function send_worker_jobs(type, code, files, workers) {
    workers.forEach((worker,index) => {
        worker.postMessage({
            index,
            type,
            code,
            files: files.filter((f,i) => { return i % workers.length === index })
        });
    });
}
