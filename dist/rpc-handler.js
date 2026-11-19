"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRpc = initRpc;
function initRpc(app, config) {
    const createRpcHandler = (method) => (req, res) => {
        let rpcData;
        if (method === "get" || method === "delete") {
            rpcData = JSON.parse(req.query.data || "{}");
            Object.defineProperty(req, "body", {
                value: rpcData.body,
                writable: true,
                configurable: true,
                enumerable: true,
            });
        }
        else {
            rpcData = JSON.parse(req.headers["x-cuple-rpc"] || "{}");
        }
        // Direct assignment (e.g. req.query = ...) does not work for getter-only properties.
        // Using Object.defineProperty creates an own property on the instance that shadows the prototype getter.
        Object.defineProperty(req, "params", {
            value: rpcData.params || {},
            writable: true,
            configurable: true,
            enumerable: true,
        });
        Object.defineProperty(req, "query", {
            value: rpcData.query || {},
            writable: true,
            configurable: true,
            enumerable: true,
        });
        let endpoint = config.routes;
        for (const segment of rpcData.segments) {
            endpoint = endpoint[segment];
        }
        if (method !== endpoint._method) {
            return res.status(400).send({
                message: "Method not allowed",
            });
        }
        endpoint._handler(req, res);
    };
    app.get(config.path, createRpcHandler("get"));
    app.post(config.path, createRpcHandler("post"));
    app.put(config.path, createRpcHandler("put"));
    app.patch(config.path, createRpcHandler("patch"));
    app.delete(config.path, createRpcHandler("delete"));
}
//# sourceMappingURL=rpc-handler.js.map