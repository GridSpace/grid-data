module.exports = (server) => {
    let join = require('path').join;
    let moddir = server.const.moddir;
    let path = server.path;
    let srcdir = join(moddir, "src");
    let webdir = join(moddir, "web");

    // create obfustacted code endpoints
    path.code("data-index",     join(srcdir, "index.js"));
    path.code("data-index-db",  join(srcdir, "index-db.js"));
    path.code("data-worker",    join(srcdir, "index-worker.js"));
    path.code("data-moment",    join(srcdir, "moment.js"));
    path.code("data-qtree",     join(srcdir, "qtree.js"));

    // server "web" dir at the root of "/data"
    path.static(moddir + "/web", "/data");

    // add path remapping
    // path.full({
    //     "/data/" : path.redir("/data"),
    //     "/data"  : path.remap("/data.html")
    // });

};
