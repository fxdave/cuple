"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
exports.serveMcp = serveMcp;
exports.toolServer = toolServer;
const client_1 = require("@cuple/client");
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const routes_js_1 = require("./routes.js");
const tools_js_1 = require("./tools.js");
function createMcpServer(routesOrFile, clientOrVariable, options) {
    if (typeof routesOrFile === "string") {
        const legacy = options;
        const tools = (0, tools_js_1.generateMcpTools)(routesOrFile, clientOrVariable, {
            tsconfigPath: legacy.tsconfigPath,
        });
        return clientServer(tools, (0, client_1.createClient)({ path: legacy.url }), legacy);
    }
    const tools = Array.isArray(routesOrFile)
        ? routesOrFile
        : (0, routes_js_1.routeTools)(routesOrFile).map(({ tool, path, endpoint }) => ({
            tool,
            path,
            method: endpoint._method,
        }));
    return clientServer(tools, clientOrVariable, options);
}
async function serveMcp(...args) {
    const server = createMcpServer(...args);
    await server.connect(new stdio_js_1.StdioServerTransport());
    return server;
}
function clientServer(tools, client, info) {
    return toolServer(async () => {
        var _a, _b, _c;
        // Read on every request: the middleware may hand out a fresh token.
        const hidden = ((_c = (await ((_b = (_a = client.clientProps).middleware) === null || _b === void 0 ? void 0 : _b.call(_a)))) !== null && _c !== void 0 ? _c : {});
        return tools.map((entry) => ({
            tool: entry.tool,
            hidden,
            call: (input) => (0, client_1.fetchCuple)(endpointOf(client, entry.path, entry.method), input),
        }));
    }, info);
}
/** The MCP server for a list of tools, which `load` gives for each request. */
function toolServer(load, info) {
    var _a, _b;
    /** What the agent sees: without the hidden inputs, flat where possible. */
    const offered = ({ tool, hidden }) => {
        var _a, _b;
        const visible = (0, tools_js_1.withoutInjected)(tool, hidden);
        return ((_a = info === null || info === void 0 ? void 0 : info.flatten) !== null && _a !== void 0 ? _a : true)
            ? ((_b = (0, tools_js_1.flattened)(visible)) !== null && _b !== void 0 ? _b : { tool: visible })
            : { tool: visible };
    };
    const server = new index_js_1.Server({ name: (_a = info === null || info === void 0 ? void 0 : info.name) !== null && _a !== void 0 ? _a : "cuple", version: (_b = info === null || info === void 0 ? void 0 : info.version) !== null && _b !== void 0 ? _b : "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
        tools: (await load()).map((entry) => offered(entry).tool),
    }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        var _a;
        const entry = (await load()).find((e) => e.tool.name === request.params.name);
        if (!entry)
            throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
        const given = partsOf((_a = request.params.arguments) !== null && _a !== void 0 ? _a : {}, offered(entry));
        // Merge each part: the hidden keys win, and parts the agent left out stay out.
        const input = {};
        for (const part of tools_js_1.INPUTS) {
            const own = entry.hidden[part];
            const value = (0, tools_js_1.isObject)(given[part]) && (0, tools_js_1.isObject)(own)
                ? Object.assign(Object.assign({}, given[part]), own) : (own !== null && own !== void 0 ? own : given[part]);
            if (value !== undefined)
                input[part] = value;
        }
        try {
            const response = (await entry.call(input));
            return Object.assign(Object.assign({ content: [{ type: "text", text: JSON.stringify(response) }] }, ((0, tools_js_1.isObject)(response) && { structuredContent: response })), { isError: response.result !== "success" });
        }
        catch (e) {
            return {
                content: [{ type: "text", text: e.message }],
                isError: true,
            };
        }
    });
    return server;
}
/**
 * The agent's arguments as request parts. Agents sometimes send an object as
 * its JSON text, so a string where the schema wants an object is parsed.
 */
function partsOf(args, shown) {
    var _a, _b;
    const schemas = ((_a = shown.tool.inputSchema.properties) !== null && _a !== void 0 ? _a : {});
    const value = (key) => {
        var _a;
        const given = args[key];
        const wants = (_a = schemas[key]) === null || _a === void 0 ? void 0 : _a.type;
        if (typeof given !== "string" || (wants !== "object" && wants !== "array"))
            return given;
        try {
            return JSON.parse(given);
        }
        catch (_b) {
            return given;
        }
    };
    if (!shown.inputs)
        return Object.fromEntries(tools_js_1.INPUTS.map((part) => [part, value(part)]));
    const parts = {};
    for (const [key, part] of Object.entries(shown.inputs)) {
        if (args[key] === undefined)
            continue;
        (_b = parts[part]) !== null && _b !== void 0 ? _b : (parts[part] = {});
        parts[part][key] = value(key);
    }
    return parts;
}
/** `["posts", "getPost"]` + `get` is `client.posts.getPost.get`. */
function endpointOf(client, path, method) {
    // The client is a Proxy, so every path exists.
    let endpoint = client;
    for (const segment of [...path, method]) {
        endpoint = endpoint[segment];
    }
    return endpoint;
}
//# sourceMappingURL=server.js.map