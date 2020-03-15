let IDB = self.indexedDB || self.mozIndexedDB || self.webkitIndexedDB || self.msIndexedDB,
    IRR = self.IDBKeyRange,
    local = null,
    databases = {};

function localGroup(group) {
    let map = local[group];
    if (map === undefined) {
        map = local[group] = {};
    }
    return map;
}

class Database {

    static open(name) {
        let db = databases[name] || new Database(name);
        databases[name] = db;
        return db;
    }

    constructor(database) {
        this.db = null;
        this.database = database;
        this.groups = [];
        this.version = undefined;
        this.queue = [];
        this.initialized = false;
    }

    group(group) {
        if (this.groups.indexOf(group) < 0) {
            this.groups.push(group);
        }
        return new Group(this, group);
    }

    keys(options) {
        let callback = options.callback;
        let group = options.group || this.database;
        let lower = options.lower;
        let upper = options.upper;
        let term = options.term || null;
        let out = [];
        this.iterate({
            callback: (k,v) => {
                if (k) {
                    out.push(k);
                } else {
                    callback(out);
                }
            },
            group,
            lower,
            upper,
            term,
            keys: true
        });
    }

    iterate(options) {
        if (!this.db) {
            this.init();
            return this.queue.push(["iterate", options]);
        }
        let callback = options.cb || options.callback;
        let group = options.group || this.database;
        let term = options.term || null;
        let lower = options.lower || null;
        let upper = options.upper || null;
        let range = lower && upper ? IRR.bound(lower,upper) :
                    lower ? IRR.lowerBound(lower) :
                    upper ? IRR.upperBound(upper) : undefined;
        if (local) {
            return callback(term,term);
        }
        // iterate over all db values for debugging
        let ost = this.db
            .transaction(group)
            .objectStore(group);
        ( options.keys ? ost.openKeyCursor(range) : ost.openCursor(range) )
            .onsuccess = function(event) {
                let cursor = event.target.result;
                if (cursor) {
                    callback(cursor.key, cursor.value);
                    cursor.continue();
                } else {
                    if (typeof(term) === 'function') {
                        term();
                    } else {
                        callback(term, term);
                    }
                }
            };
    }

    init() {
        if (this.initialized) {
            return this;
        }

        function fallback() {
            console.log(`IndexedDB support missing or disabled. Falling back to memory for "${ostore}"`);
            local = {};
            this.runQueue();
        }

        try {
            let request = IDB.open(this.database, this.version);

            request.onupgradeneeded = (event) => {
                this.db = request.result;
                this.version = this.db.version;
                this.groups.forEach(group => {
                    this.db.createObjectStore(group);
                });
                event.target.transaction.oncomplete = (event) => {
                    this.runQueue();
                };
            };

            request.onsuccess = (event) => {
                this.db = request.result;
                this.version = this.db.version;
                this.runQueue();
            };

            request.onerror = (event) => {
                console.log({open_error:event});
                fallback();
            };
        } catch (e) {
            console.log({init_error:event});
            fallback();
        }

        this.initialized = true;
        return this;
    }

    runQueue() {
        if (this.queue.length > 0) {
            let i = 0, q = this.queue, e;
            while (i < q.length) {
                e = q[i++];
                switch (e[0]) {
                    case 'get': this.get(e[1]); break;
                    case 'put': this.put(e[1]); break;
                    case 'remove': this.remove(e[1]); break;
                    case 'iterate': this.iterate(e[1]); break;
                    case 'clear': this.clear(e[1]);
                }
            }
            this.queue = [];
        }
    }

    put(options) {
        let callback = options.cb || options.callback;
        let group = options.group || this.database;
        let key = options.key;
        let val = options.val || options.value;
        if (!this.db) {
            this.init();
            return this.queue.push(['put', options]);
        }
        if (local) {
            localGroup(group)[key] = val;
            if (callback) callback(true);
            return;
        }
        try {
            let req = this.db
                .transaction(group, "readwrite")
                .objectStore(group)
                .put(val, key);
            if (callback) {
                req.onsuccess = function(e) { callback(true) };
                req.onerror = function(e) { callback(false, e) };
            }
        } catch (e) {
            console.log({db_put_error: e});
            if (callback) callback(false, e);
        }
    }

    get(options) {
        let callback = options.cb || options.callback;
        let group = options.group || this.database;
        let key = options.key;
        if (local) {
            if (callback) callback(localGroup(group)[key]);
            return;
        }
        if (!this.db) {
            this.init();
            return this.queue.push(['get', options]);
        }
        try {
            let req = this.db
                .transaction(group)
                .objectStore(group)
                .get(key);
            if (callback) {
                req.onsuccess = function(e) { callback(req.result) };
                req.onerror = function(e) { callback(null, e) };
            }
        } catch (e) {
            console.log({db_get_error: e});
            if (callback) callback(null, e);
        }
    }

    remove(options) {
        let callback = options.cb || options.callback;
        let group = options.group || this.database;
        let key = options.key;
        if (local) {
            delete localGroup(group)[key];
            if (callback) callback(true);
            return;
        }
        if (!this.db) {
            this.init();
            return this.queue.push(['remove', options]);
        }
        try {
            let req = this.db
                .transaction(group, "readwrite")
                .objectStore(group)
                .delete(key);
            if (callback) {
                req.onsuccess = function(e) { callback(true) };
                req.onerror = function(e) { callback(false, e) };
            }
        } catch (e) {
            console.log({db_remove_error: e});
            if (callback) callback(false, e);
        }
    }

    clear() {
        let group = options.group || this.database;
        if (!this.db) {
            this.init();
            return this.queue.push(['clear', options]);
        }
        if (local) {
            return local[group] = {};
        }
        this.db
            .transaction(group, "readwrite")
            .objectStore(group)
            .clear();
    }
}

class Group {
    constructor(storage, group) {
        this.storage = storage;
        this.group = group;
    }

    keys(options) {
        let group = this.group;
        if (typeof(options) === 'function') {
            options = {
                group: group,
                callback: options
            }
        } else {
            options.group = group;
        }
        this.storage.keys(options);
    }

    iterate(options) {
        let group = this.group;
        if (typeof(options) === 'function') {
            options = {
                group: group,
                callback: options
            }
        } else {
            options.group = group;
        }
        this.storage.iterate(options);
    }

    get(key, callback) {
        let group = this.group;
        this.storage.get({
            callback,
            group,
            key
        });
    }

    put(key, val, callback) {
        let group = this.group;
        this.storage.put({
            callback,
            group,
            key,
            val
        });
    }

    remove(key, callback) {
        let group = this.group;
        this.storage.remove({
            callback,
            group,
            key
        });
    }

    clear(callback) {
        this.storage.clear({ group: this.group });
    }
}
