"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeTools = routeTools;
const zod_1 = require("zod");
const tools_js_1 = require("./tools.js");
const isEndpoint = (value) => (0, tools_js_1.isObject)(value) && typeof value._handler === "function";
/**
 * One tool per endpoint: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 *
 * @param skipInputs How many of each endpoint's schemas to leave out: those its
 *   chain validated before the tool is called.
 */
function routeTools(routes, skipInputs = 0) {
    const tools = [];
    const walk = (node, path) => {
        for (const [key, value] of Object.entries(node)) {
            if (isEndpoint(value))
                tools.push(routeTool([...path, key], value, skipInputs));
            else if ((0, tools_js_1.isObject)(value))
                walk(value, [...path, key]);
        }
    };
    walk(routes, []);
    const seen = new Set();
    for (const { tool } of tools) {
        if (seen.has(tool.name))
            throw new Error(`Two routes become the tool "${tool.name}"`);
        seen.add(tool.name);
        // Claude and OpenAI cap tool names at 64 characters; some clients count the server's name too.
        if (tool.name.length > 64)
            console.warn(`[cuple/mcp] "${tool.name}" is over 64 characters`);
    }
    return tools;
}
function routeTool(path, endpoint, skipInputs) {
    var _a, _b, _c;
    const name = path.join("_").replace(/[^a-zA-Z0-9_-]/g, "_");
    const route = path.join(".");
    if (!endpoint._inputs)
        throw new Error(`${route}: built by an older @cuple/server; MCP needs 2.6 or later`);
    if (endpoint._kind === "sse" || endpoint._sse)
        throw new Error(`${route}: SSE endpoints can't be MCP tools, a tool call has one result`);
    if (endpoint._kind !== "json" || !endpoint._invoke)
        throw new Error(`${route}: raw endpoints can't be MCP tools, they answer through res`);
    if (endpoint._rawBody)
        throw new Error(`${route}: rawBody() endpoints can't be MCP tools, an agent sends JSON`);
    const properties = {};
    const required = [];
    for (const part of tools_js_1.INPUTS) {
        const schemas = endpoint._inputs
            .slice(skipInputs)
            .filter((input) => input.part === part)
            .map((input) => jsonSchema(input.schema, `${route} ${part}`));
        if (!schemas.length)
            continue;
        const schema = merged(schemas);
        properties[part] = (0, tools_js_1.forClients)(schema);
        if (isRequired(schema))
            required.push(part);
    }
    const meta = ((_a = endpoint._meta) !== null && _a !== void 0 ? _a : {});
    const description = typeof meta.description === "string" ? meta.description : undefined;
    if (!description)
        console.warn(`[cuple/mcp] ${route} has no .meta({ description }) to tell agents what it's for`);
    return {
        path,
        endpoint,
        tool: {
            name,
            description: description !== null && description !== void 0 ? description : `${endpoint._method.toUpperCase()} ${route}.`,
            inputSchema: { type: "object", properties, required },
            // Without readOnlyHint, ChatGPT asks the user to confirm every call. A POST
            // that only reads says so with .meta({ readOnly: true }).
            annotations: {
                readOnlyHint: (_b = flag(meta.readOnly)) !== null && _b !== void 0 ? _b : endpoint._method === "get",
                destructiveHint: (_c = flag(meta.destructive)) !== null && _c !== void 0 ? _c : endpoint._method === "delete",
            },
        },
    };
}
const flag = (value) => (typeof value === "boolean" ? value : undefined);
/** What the agent may send: the schema's input side. */
function jsonSchema(schema, where) {
    let json;
    try {
        json = (0, zod_1.toJSONSchema)(schema, { io: "input", unrepresentable: "throw" });
    }
    catch (_a) {
        console.warn(`[cuple/mcp] ${where}: part of the schema can't be told to agents`);
        json = (0, zod_1.toJSONSchema)(schema, { io: "input", unrepresentable: "any" });
    }
    return withoutRefs(json);
}
/**
 * Clients rewrite tool schemas for their provider and disagree about `$ref`,
 * so a recursive part says nothing rather than carry a pointer they may drop.
 * The endpoint validates the arguments anyway.
 */
function withoutRefs(value) {
    if (Array.isArray(value))
        return value.map(withoutRefs);
    if (!(0, tools_js_1.isObject)(value))
        return value;
    if ("$ref" in value)
        return {};
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
        if (key === "$schema" || key === "$defs")
            continue;
        out[key] = withoutRefs(inner);
    }
    return out;
}
/** A link's schema and the route's own for the same part, as one. */
function merged(schemas) {
    var _a;
    if (schemas.length === 1)
        return schemas[0];
    if (!schemas.every((schema) => schema.type === "object"))
        return { allOf: schemas };
    const properties = {};
    const required = new Set();
    for (const schema of schemas) {
        Object.assign(properties, schema.properties);
        for (const key of (_a = schema.required) !== null && _a !== void 0 ? _a : [])
            required.add(key);
    }
    return { type: "object", properties, required: [...required] };
}
/** An object is optional when every one of its fields is. */
function isRequired(schema) {
    var _a;
    if (schema.type !== "object")
        return true;
    return ((_a = schema.required) !== null && _a !== void 0 ? _a : []).length > 0;
}
//# sourceMappingURL=routes.js.map