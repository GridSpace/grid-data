module.exports = (server) => {
    server.path.code("data-qtree", server.const.moddir + "/web/qtree.js");
    server.path.code("data-index", server.const.moddir + "/web/index.js");
    server.path.code("data-index-db", server.const.moddir + "/web/index-db.js");
    server.path.static(server.const.moddir + "/web", "/data");
};
