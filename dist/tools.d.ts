import { type RouteInfo } from "@cuple/inspect";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
/**
 * One route as an MCP tool, and the HTTP method to call it with. Plain data, so
 * a list of them can be written at build time and served where the TypeScript
 * sources are not. Make them with {@link generateMcpTools} or the
 * `cuple-mcp tools` command.
 */
export type McpTool = {
    method: string;
    /** The route's place in the routes object, e.g. `["posts", "getPost"]`. */
    path: string[];
    tool: Tool;
};
/** The request parts a tool takes: whatever the route declares. */
export type Part = (typeof INPUTS)[number];
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
export declare function generateMcpTools(filePath: string, variableName: string, options?: {
    /** Defaults to the nearest `tsconfig.json`. */
    tsconfigPath?: string;
}): McpTool[];
/**
 * The request parts a tool takes. A route that needs `authorization` says so in
 * its tool, so the agent knows to log in and send the token.
 */
export declare const INPUTS: readonly ["params", "query", "body", "headers"];
/**
 * One tool per route: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 */
export declare function routeToTool(route: RouteInfo): Tool;
/**
 * Several clients handle `anyOf` but not `oneOf`, and see a union of literals
 * best as one `enum`.
 */
export declare function forClients(schema: object): object;
/** The request parts a client injects, e.g. `{ headers: { authorization: "…" } }`. */
export type Injected = Partial<Record<(typeof INPUTS)[number], unknown>>;
/**
 * The tool without what the client injects: those inputs are the server's to
 * send, so the agent neither sees nor sends them. A part goes entirely when
 * nothing is left of it, or when the client injects it whole.
 */
export declare function withoutInjected(tool: Tool, injected: Injected): Tool;
export declare const isObject: (value: unknown) => value is Record<string, unknown>;
/**
 * The tool with its inputs at the top level, `{ id, title }` rather than
 * `{ params: { id }, body: { title } }`: agents fill flat arguments more
 * reliably. `inputs` says which part each one goes back to. `null` when the
 * parts can't be merged: a key in two of them, or a part that isn't an object.
 */
export declare function flattened(tool: Tool): {
    tool: Tool;
    inputs: Record<string, Part>;
} | null;
