"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpEndpoint = createMcpEndpoint;
const http_js_1 = require("./http.js");
const routes_js_1 = require("./routes.js");
const server_js_1 = require("./server.js");
/**
 * An MCP endpoint (stateless Streamable HTTP) at the builder's path, behind its
 * chain. Tools run in-process: no RPC URL, no second HTTP request.
 *
 * @example
 * export const mcp = createMcpEndpoint(builder.path("/mcp").chain(mcpAuthLink), {
 *   tools: (b) => ({
 *     whoAmI: b.meta({ description: "…" }).get(async ({ data }) => success({ user: data.user })),
 *   }),
 *   routes: {
 *     pick: { getPost: routes.posts.getPost },
 *     inject: async ({ data }) => ({ headers: { authorization: `Bearer ${await tokenFor(data.user)}` } }),
 *   },
 * });
 */
function createMcpEndpoint(builder, options) {
    var _a, _b, _c, _d;
    const chain = builder._chain;
    // Without a path, the tools aren't registered as HTTP routes of their own.
    const ownTools = ((_b = (_a = options.tools) === null || _a === void 0 ? void 0 : _a.call(options, builder.path(""))) !== null && _b !== void 0 ? _b : {});
    const own = (0, routes_js_1.routeTools)(ownTools, chain.inputs);
    const borrowed = options.routes ? (0, routes_js_1.routeTools)(options.routes.pick) : [];
    const names = new Set(own.map(({ tool }) => tool.name));
    for (const { tool } of borrowed) {
        if (names.has(tool.name))
            throw new Error(`Two routes become the tool "${tool.name}"`);
    }
    const mcp = builder.postRaw(async ({ req, res, data: response }) => {
        var _a;
        if (!response.next) {
            const { next, statusCode } = response, rest = __rest(response, ["next", "statusCode"]);
            if (statusCode === 401)
                res.set("WWW-Authenticate", (_a = options.wwwAuthenticate) !== null && _a !== void 0 ? _a : "Bearer");
            res.status(statusCode).json(rest);
            return;
        }
        const { next } = response, data = __rest(response, ["next"]);
        const hidden = options.routes ? await options.routes.inject({ data, req }) : {};
        const served = [
            ...own.map(({ tool, endpoint }) => ({
                tool,
                hidden: {},
                call: (input) => endpoint._invoke(input, { req, skip: chain.middlewares, data }),
            })),
            ...borrowed.map(({ tool, endpoint }) => ({
                tool,
                hidden,
                call: (input) => endpoint._invoke(input, { req }),
            })),
        ];
        const listed = options.toolListMiddleware
            ? refined(served, await options.toolListMiddleware({ data, tools: served.map((s) => s.tool) }))
            : served;
        await (0, http_js_1.handleMcpRequest)((0, server_js_1.toolServer)(async () => listed, options), req, res);
    });
    // Stateless: no event stream to open and no session to end.
    for (const method of ["getRaw", "deleteRaw"]) {
        builder[method](async ({ res }) => {
            res.status(405).set("Allow", "POST").end();
        });
    }
    return { mcp, tools: ownTools, routes: ((_d = (_c = options.routes) === null || _c === void 0 ? void 0 : _c.pick) !== null && _d !== void 0 ? _d : {}) };
}
function refined(served, tools) {
    const byName = new Map(served.map((entry) => [entry.tool.name, entry]));
    return tools.map((tool) => {
        const entry = byName.get(tool.name);
        if (!entry)
            throw new Error(`toolListMiddleware returned "${tool.name}", which is no tool`);
        return Object.assign(Object.assign({}, entry), { tool });
    });
}
//# sourceMappingURL=endpoint.js.map