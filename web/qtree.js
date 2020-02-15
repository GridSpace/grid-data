/** copyright stewart allen <sa@grid.space> */

class Node {
    constructor(key) {
        if (typeof(key) === 'object') {
            let obj = key;
            this.key = obj.key;
            this.count = obj.count;
            this.nodes = obj.nodes;
            if (obj.child) {
                this.child = {};
                for (let key in obj.child) {
                    this.child[key] = new Node(obj.child[key]);
                }
            }
        } else {
            this.key = key;
            this.count = 1;
            this.child = null;
            this.nodes = 0;
        }
    }

    put(key) {
        let count = 1;
        if (key.charAt(0) === '~') {
            count = 0;
            key = key.substring(1);
        }
        if (this.child) {
            let has = this.child[key];
            if (has) {
                has.count += count;
                return has;
            } else {
                this.nodes++;
                return this.child[key] = new Node(key);
            }
        } else {
            let node = new Node(key);
            this.nodes++;
            this.child = { [key]: node };
            return node;
        }
    }

    get(key) {
        let match = [];
        let children = this.child;
        if (!children) {
            return match;
        }
        if (key === '*') {
            for (let key in children) {
                if (children.hasOwnProperty(key)) {
                    match.push(children[key]);
                }
            }
        } else if (key.indexOf(',') > 0) {
            key = key.split(',');
            for (let i=0; i<key.length; i++) {
                let child = children[key[i]];
                if (child) {
                    match.push(child);
                }
            }
        } else {
            let node = children[key];
            if (node) {
                match.push(node);
            }
        }
        return match;
    }

    insert() {
        let node = this;
        let args = [...arguments];
        if (!args.length) {
            return;
        }
        let path = args.length > 1 ? args : args[0].split('/');
        path.forEach(key => {
            node = node.put(key);
        });
    }

    query(path, meta) {
        return new Query(path, meta).query(this);
    }
}

class Query {
    constructor(path, meta) {
        this.path = path.split("/");
        this.table = [];
        this.meta = meta || {};
    }

    query(node, index, row) {
        index = index || 0;
        if (index >= this.path.length) {
            this.meta.maxcol = row.length - 1;
            this.table.push(row);
            return;
        }
        let [key, prop] = this.path[index].split(':');
        let include = false;
        if (key.charAt(0) === '+') {
            include = true;
            key = key.substring(1) || '*';
        }
        let next = node.get(key);
        prop = (prop || '').split(',');
        outer: for (let i=0; i<next.length; i++) {
            let el = next[i];
            let top = index === 0;
            let out = top ? [] : row.slice();
            if (include) {
                out.push(el.key);
            }
            if (prop.length) {
                for (let j=0; j<prop.length; j++) {
                    let pkey = prop[j];
                    let plim = null;
                    let psel = null;
                    let pio = 0;
                    if ((pio = pkey.indexOf('>=')) > 0) {
                        psel = '>=';
                    } else if ((pio = pkey.indexOf('>')) > 0) {
                        psel = '>';
                    } else if ((pio = pkey.indexOf('<=')) > 0) {
                        psel = '<=';
                    } else if ((pio = pkey.indexOf('<')) > 0) {
                        psel = '<';
                    } else if ((pio = pkey.indexOf('=')) > 0) {
                        psel = '=';
                    }
                    if (psel) {
                        plim = pkey.substring(pio + psel.length);
                        if (plim.indexOf('.') >= 0) {
                            plim = parseFloat(plim);
                        } else {
                            plim = parseInt(plim);
                        }
                        pkey = pkey.substring(0, pio);
                    }
                    let pval = null;
                    let padd = pkey.charAt(0) === '+';
                    if (padd) {
                        pkey = pkey.substring(1);
                    }
                    switch(pkey) {
                        case 'int':
                            pval = parseInt(el.key);
                            break;
                        case 'float':
                            pval = parseFloat(el.key);
                            break;
                        case 'count':
                            pval = el.count;
                            break;
                        case 'nodes':
                            pval = el.nodes;
                            break;
                    }
                    if (pval !== null) {
                        if (psel) {
                            if (psel === '<'  && pval >= plim) continue outer;
                            if (psel === '<=' && pval >  plim) continue outer;
                            if (psel === '>'  && pval <= plim) continue outer;
                            if (psel === '>=' && pval <  plim) continue outer;
                            if (psel === '='  && pval !== plim) continue outer;
                        }
                        if (padd) {
                            out.push(pval);
                        }
                    }
                }
            }
            this.query(el, index + 1, out);
        }
        return this;
    }

    order() {
        let args = [...arguments];
        if (args.length) {
            let otable = this.table;
            let ntable = [];
            for (let i=0; i<otable.length; i++) {
                let orow = otable[i];
                let nrow = [];
                for (let j=0; j<args.length; j++) {
                    nrow.push(orow[args[j]]);
                }
                ntable.push(nrow);
            }
            this.table = ntable;
        }
        return this;
    }

    sort() {
        let cols = [...arguments];
        this.table.sort((a, b) => {
            if (a.sort === -1) return -1;
            if (a.sort === 1) return 1;
            if (b.sort === -1) return 1;
            if (b.sort === 1) return -1;
            for (let i=0; i<cols.length; i++) {
                let col = cols[i];
                let abs = Math.abs(col);
                let av = a[abs];
                let bv = b[abs];
                if (av === bv) {
                    continue;
                }
                if (col < 0 || Object.is(-0,col)) {
                    return av < bv ? 1 : -1;
                } else {
                    return av < bv ? -1 : 1;
                }
            }
            return 0;
        });
        return this;
    }

    merge(cols,count) {
        let otable = this.table;
        if (otable.length < 2) {
            return this;
        }
        cols = cols.split('');
        let ntable = [];
        let ckey = null;
        let crow = null;
        let merged = 0;
        let keys = cols.map((c,i) => c === 'k' ? i : null).filter(v => v !== null);
        let sums = cols.map((c,i) => c === '+' ? i : null).filter(v => v !== null);
        let maxs = cols.map((c,i) => c === 'M' ? i : null).filter(v => v !== null);
        let mins = cols.map((c,i) => c === 'm' ? i : null).filter(v => v !== null);
        let avgs = cols.map((c,i) => c === 'a' ? i : null).filter(v => v !== null);
        let igns = cols.map((c,i) => c === 'i' ? i : null).filter(v => v !== null);
        for (let i=0; i<otable.length; i++) {
            let nrow = otable[i];
            let nkey = keys.map(i => nrow[i]).join('');
            if (i === 0) {
                ckey = nkey;
                crow = nrow.slice();
                merged = 1;
            } else if (nkey !== ckey || i === otable.length - 1) {
                avgs.forEach(col => crow[col] /= merged);
                if (igns.length) {
                    crow = crow.filter((v,c) => igns.indexOf(c) < 0)
                }
                if (count) {
                    crow.push(merged);
                }
                ntable.push(crow);
                meta.maxcol = crow.length - 1;
                ckey = nkey;
                crow = nrow.slice();
                merged = 1;
            } else {
                sums.forEach(col => crow[col] += nrow[col]);
                avgs.forEach(col => crow[col] += nrow[col]);
                maxs.forEach(col => crow[col] = Math.max(nrow[col],crow[col]));
                mins.forEach(col => crow[col] = Math.min(nrow[col],crow[col]));
                merged++;
            }
        }
        this.table = ntable;
        return this;
    }

    pivot(row_col, col_col, val_col, actions) {
        let rows = {};
        let cols = {};
        let rk_map = {};
        let ck_map = {};
        let otable = this.table;
        if (typeof(val_col) !== 'number') {
            actions = val_col;
            val_col = undefined;
        }
        actions = (actions || '+').split(',');
        for (let i=0; i<otable.length; i++) {
            let table_row = otable[i];
            let row_key = table_row[row_col];
            let col_key = table_row[col_col];
            let val = val_col >= 0 ? table_row[val_col] : 1;
            rk_map[row_key] = row_key;
            let row = rows[row_key];
            if (!row) {
                row = rows[row_key] = {};
            }
            cols[col_key] = 0;
            ck_map[col_key] = col_key;
            let cell_new = false;
            let cell_val = row[col_key];
            if (cell_val === undefined) {
                cell_val = 0;
                cell_new = true;
            }
            if (val !== undefined)
            actions.forEach(action => {
                switch (action) {
                    case '+': cell_val += val; break;
                    case '-': cell_val -= val; break;
                    case '*': if (cell_new) {
                            cell_val = val;
                        } else {
                            cell_val *= val;
                        }
                        break;
                    }
            });
            row[col_key] = cell_val;
        }
        let sort = (a,b) => {
            if (a === b) return 0;
            return a > b ? 1 : -1;
        };
        let meta = this.meta;
        let ntable = [];
        let row_keys = Object.keys(rows).map(v => rk_map[v]).sort(sort);
        let col_keys = Object.keys(cols).map(v => ck_map[v]).sort(sort);
        let row_sum = actions.indexOf('r+') >= 0;
        for (let r=0; r<row_keys.length; r++) {
            let row_key = row_keys[r];
            let row_in = rows[row_key];
            let row_out = [row_key];
            let row_end = 0;
            for (let c=0; c<col_keys.length; c++) {
                let row_val = row_in[col_keys[c]]
                row_out.push(row_val);
                if (row_sum && row_val !== undefined) {
                    row_end += row_val;
                }
            }
            if (row_sum) {
                row_out.push(row_end);
            }
            ntable.push(row_out);
        }
        let header = [''].concat(col_keys);
        if (row_sum) {
            header.push('');
            header.sort = -1;
            meta.keycol = [0,header.length-1];
        } else {
            meta.keycol = [0];
        }
        meta.maxcol = header.length - 1;
        meta.header = header;
        ntable.splice(0,0,header);
        let col_sum = actions.indexOf('c+') > 0;
        if (col_sum) {
            let col_end = new Array(header.length).fill(0);
            col_end[0] = '';
            let row_len = header.length;
            for (let i=1; i<ntable.length; i++) {
                let row_out = ntable[i];
                for (let j=1; j<row_len; j++) {
                    let cell_val = row_out[j];
                    if (cell_val) {
                        col_end[j] += cell_val;
                    }
                }
            }
            meta.footer = col_end;
            col_end.sort = 1;
            ntable.push(col_end);
        }
        this.table = ntable;
        return this;
    }

    result() {
        return {table: this.table.slice(), meta: this.meta};
    }

    print() {
        this.table.forEach(line => { console.log(line) });
    }
}

// so we can use this code in browser
if (typeof(module) === 'undefined') {
    var module = { parent: 'fake module' };
}

// for nodejs
module.exports = {
    Node, Query
};

// for nodejs command line start
if (!module.parent) {
    function parse_json(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    function parse_log(data) {
        let tree = new Node();
        let lines = data.split('\n');
        for (let i=0; i<lines.length; i++) {
            let line = lines[i];
            if (!line) {
                continue;
            }
            let time = line.substring(0,13);
            let yr = time.substring(0,2);
            let mo = time.substring(2,4);
            let da = time.substring(4,6);
            let hh = time.substring(7,9);
            let mm = time.substring(9,11);
            let ss = time.substring(11,13);
            let json = parse_json(line.substring(14));
            if (json) {
                tree.insert(`time/${yr}${mo}${da}/${hh}/${ss}`);
                tree.insert(`~user/~${json.mo}/init/${json.up.init}`);
                tree.insert(`~user/~${json.mo}/dev/${json.up.dn}`);
                tree.insert(`~user/~${json.mo}/os/${json.os}`);
                tree.insert(`~user/~${json.mo}/br/${json.br}`);
            } else {
                log.print({invalid_json: line});
            }
        }
        tree.query("time/+:+count").print();
        tree.query("user/+/dev:+count>10/+:+count>2").sort('iaia').order(1,0,3,2).print();
    }

    function read_data(files, index, buffer) {
        if (index >= files.length) {
            return parse_log(buffer || '');
        }
        fs.readFile(files[index], function(err, data) {
            if (data) {
                buffer = (buffer || '') + data.toString();
            }
            read_data(files, index + 1, buffer);
        });
    }

    let fs = require('fs'),
        args = require('minimist')(process.argv.slice(2)),
        log = require('gs-log-util').default,
        util = require('util'),
        moment = require('moment'),
        WebServer = require('gs-web-server'),
        server = new WebServer({
            dir: "web",
            port: args.port || 8001
        });
        log.print({serving: server.dir, port: server.port, portsec: server.portsec});

    read_data(args._, 0);
}
