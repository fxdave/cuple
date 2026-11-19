"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isObject = exports.INPUTS = void 0;
exports.generateMcpTools = generateMcpTools;
exports.routeToTool = routeToTool;
exports.forClients = forClients;
exports.withoutInjected = withoutInjected;
exports.flattened = flattened;
const inspect_1 = require("@cuple/inspect");
const openapi_1 = require("@cuple/openapi");
/**
 * Reads your routes from the TypeScript source and returns one tool each.
 *
 * @param filePath The file that exports your routes, e.g. `"./src/routes.ts"`.
 * @param variableName The exported variable holding them, e.g. `"routes"`.
 * @example
 * // Usually run at build time, through the CLI, which writes a typed module:
 * //   cuple-mcp tools src/routes.ts routes > src/mcp-tools.ts
 * const tools = generateMcpTools("./src/routes.ts", "routes");
 */
function generateMcpTools(filePath, variableName, options) {
    const { routes } = (0, inspect_1.inspectRoutes)(filePath, variableName, options);
    const tools = routes.map((route) => ({
        method: route.method,
        path: route.name.split("."),
        tool: routeToTool(route),
    }));
    const seen = new Set();
    for (const { tool } of tools) {
        if (seen.has(tool.name))
            throw new Error(`Two routes become the tool "${tool.name}"`);
        seen.add(tool.name);
        // Claude and OpenAI cap tool names at 64 characters; some clients count the server's name too.
        if (tool.name.length > 64)
            console.warn(`[cuple-mcp] "${tool.name}" is over 64 characters`);
    }
    return tools;
}
/**
 * The request parts a tool takes. A route that needs `authorization` says so in
 * its tool, so the agent knows to log in and send the token.
 */
exports.INPUTS = ["params", "query", "body", "headers"];
/**
 * A tool's `inputSchema` is JSON Schema, which has `$defs`/`$ref`, but an agent
 * reaches it through a client that usually rewrites it into a provider's
 * function-calling schema, and those disagree about `$ref` — some resolve it,
 * some ignore it, some reject the tool. A pointer the client drops is worse than
 * no constraint at all, whereas `{}` is a schema every client accepts and the
 * call still goes through the RPC endpoint, which type-checks the arguments
 * properly anyway.
 *
 * So the names stay in the OpenAPI document, and a tool says nothing about the
 * shape it could not describe. It costs little: inputs come from zod schemas,
 * and a recursive one (`z.lazy`) does not survive extraction to begin with.
 */
function withoutRefs(schema) {
    switch (schema.type) {
        case "ref":
            return { type: "unknown" };
        case "array":
            return { type: "array", items: withoutRefs(schema.items) };
        case "union":
            return { type: "union", variants: schema.variants.map(withoutRefs) };
        case "object": {
            const properties = {};
            for (const [key, info] of Object.entries(schema.properties)) {
                properties[key] = { schema: withoutRefs(info.schema), required: info.required };
            }
            return { type: "object", properties };
        }
        default:
            return schema;
    }
}
/**
 * One tool per route: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 */
function routeToTool(route) {
    var _a, _b, _c, _d, _e;
    const properties = {};
    const required = [];
    for (const input of exports.INPUTS) {
        const schema = route[`${input}Schema`];
        if (schema === null)
            continue;
        properties[input] = forClients((0, openapi_1.convertSchemaToOpenAPI)(withoutRefs(schema)));
        if (isRequired(schema))
            required.push(input);
    }
    return {
        name: route.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
        description: (_a = route.description) !== null && _a !== void 0 ? _a : describe(route),
        inputSchema: { type: "object", properties, required },
        // Without readOnlyHint, ChatGPT asks the user to confirm every call. A POST
        // that only reads says so with .meta({ readOnly: true }).
        annotations: {
            readOnlyHint: (_c = flag((_b = route.meta) === null || _b === void 0 ? void 0 : _b.readOnly)) !== null && _c !== void 0 ? _c : route.method === "get",
            destructiveHint: (_e = flag((_d = route.meta) === null || _d === void 0 ? void 0 : _d.destructive)) !== null && _e !== void 0 ? _e : route.method === "delete",
        },
    };
}
const flag = (value) => (typeof value === "boolean" ? value : undefined);
/** For a route without `.meta({ description })`: better than nothing. */
function describe(route) {
    // cuple's own results (bad input, a crash) are true of every route.
    const results = route.response.flatMap((r) => r.result && r.result !== "unexpected-error" && !r.result.startsWith("invalid-")
        ? [r.result]
        : []);
    const answers = results.length ? ` Answers ${[...new Set(results)].join(", ")}.` : "";
    return `${route.method.toUpperCase()} ${route.name}.${answers}`;
}
/**
 * Several clients handle `anyOf` but not `oneOf`, and see a union of literals
 * best as one `enum`.
 */
function forClients(schema) {
    var _a;
    if (Array.isArray(schema))
        return schema.map(forClients);
    if (typeof schema !== "object" || schema === null)
        return schema;
    const out = {};
    for (const [key, value] of Object.entries(schema)) {
        out[key] = typeof value === "object" && value !== null ? forClients(value) : value;
    }
    const variants = ((_a = out.oneOf) !== null && _a !== void 0 ? _a : out.anyOf);
    if (!variants)
        return out;
    delete out.oneOf;
    delete out.anyOf;
    // `{ enum: ["a"] }` from inspect, `{ const: "a" }` from zod.
    const values = (v) => Array.isArray(v.enum) ? v.enum : "const" in v ? [v.const] : null;
    const literals = variants.every((v) => values(v) && v.type === variants[0].type && Object.keys(v).length === 2);
    return literals
        ? Object.assign(Object.assign({}, out), { type: variants[0].type, enum: variants.flatMap((v) => values(v)) }) : Object.assign(Object.assign({}, out), { anyOf: variants });
}
/** An object is optional when every one of its fields is. */
function isRequired(schema) {
    if (schema.type !== "object")
        return true;
    return Object.values(schema.properties).some((property) => property.required);
}
/**
 * The tool without what the client injects: those inputs are the server's to
 * send, so the agent neither sees nor sends them. A part goes entirely when
 * nothing is left of it, or when the client injects it whole.
 */
function withoutInjected(tool, injected) {
    var _a, _b, _c;
    const schema = tool.inputSchema;
    const properties = Object.assign({}, schema.properties);
    let required = (_a = schema.required) !== null && _a !== void 0 ? _a : [];
    for (const part of exports.INPUTS) {
        const value = injected[part];
        if (value === undefined || !(part in properties))
            continue;
        const partSchema = properties[part];
        const keys = (0, exports.isObject)(value) ? Object.keys(value) : null;
        const left = keys
            ? Object.entries((_b = partSchema.properties) !== null && _b !== void 0 ? _b : {}).filter(([key]) => !keys.includes(key))
            : [];
        if (left.length === 0) {
            delete properties[part];
            required = required.filter((key) => key !== part);
            continue;
        }
        const partRequired = ((_c = partSchema.required) !== null && _c !== void 0 ? _c : []).filter((key) => !(keys === null || keys === void 0 ? void 0 : keys.includes(key)));
        properties[part] = Object.assign(Object.assign({}, partSchema), { properties: Object.fromEntries(left), required: partRequired });
        if (partRequired.length === 0)
            required = required.filter((key) => key !== part);
    }
    return Object.assign(Object.assign({}, tool), { inputSchema: Object.assign(Object.assign({}, schema), { properties, required }) });
}
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
exports.isObject = isObject;
/**
 * The tool with its inputs at the top level, `{ id, title }` rather than
 * `{ params: { id }, body: { title } }`: agents fill flat arguments more
 * reliably. `inputs` says which part each one goes back to, and `parts` lists
 * them all. `null` when the parts can't be merged: a key in two of them, or a
 * part that isn't an object.
 */
function flattened(tool) {
    var _a, _b, _c, _d, _e;
    const schema = tool.inputSchema;
    const properties = {};
    const required = [];
    const inputs = {};
    for (const [part, value] of Object.entries((_a = schema.properties) !== null && _a !== void 0 ? _a : {})) {
        const partSchema = value;
        if (!partSchema.properties)
            return null;
        for (const [key, keySchema] of Object.entries(partSchema.properties)) {
            if (key in inputs)
                return null;
            inputs[key] = part;
            properties[key] = keySchema;
            const partRequired = (_c = (_b = schema.required) === null || _b === void 0 ? void 0 : _b.includes(part)) !== null && _c !== void 0 ? _c : false;
            if (partRequired && ((_d = partSchema.required) === null || _d === void 0 ? void 0 : _d.includes(key)))
                required.push(key);
        }
    }
    return {
        tool: Object.assign(Object.assign({}, tool), { inputSchema: { type: "object", properties, required } }),
        inputs,
        parts: Object.keys((_e = schema.properties) !== null && _e !== void 0 ? _e : {}),
    };
}
//# sourceMappingURL=tools.js.map