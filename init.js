module.exports = (server) => {
    server.path.static(server.const.moddir + "/web", "/data");
};
