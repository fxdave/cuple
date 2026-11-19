import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { type McpRoutes, type ToolRoutes } from "./routes.js";
import { type Injected, type McpTool } from "./tools.js";
/** A `@cuple/client` of your routes, with or without `.with(…)`. */
type AnyClient = object;
export type McpServerInfo = {
    /** How the server introduces itself to the agent. Default: `"cuple"`. */
    name?: string;
    /** Default: `"1.0.0"`. */
    version?: string;
    /**
     * Offer each tool's inputs at the top level, `{ id, title }` rather than
     * `{ params: { id }, body: { title } }`, which agents fill more reliably.
     * Tools whose parts share a key keep the parts. Default: `true`.
     */
    flatten?: boolean;
};
/** @deprecated The options of `createMcpServer(filePath, variableName, options)`. */
export type McpOptions = McpServerInfo & {
    /** Your server's RPC endpoint, which the tools call, e.g. `"http://localhost:8080/rpc"`. */
    url: string;
    /** Defaults to the nearest `tsconfig.json`. */
    tsconfigPath?: string;
};
/**
 * A tool as one MCP request serves it: what the server sends for the agent
 * (`hidden`, which the agent neither sees nor overrides), and how to call it.
 */
export type ServedTool = {
    tool: Tool;
    hidden: Injected;
    call: (input: Injected) => Promise<unknown>;
};
/**
 * An MCP server whose tools call your routes through `client`, not connected
 * yet: give it any transport from `@modelcontextprotocol/sdk`. It's for a
 * separate process, such as a stdio server; in your own server, use
 * `createMcpEndpoint`.
 *
 * What the client's `with({ middleware })` injects (a token, a tenant) goes
 * with every call and is hidden from the agent.
 *
 * @param routes Your routes, or tools from `cuple-mcp tools`.
 * @example
 * const api = createClient<typeof routes>({ path: "http://localhost:8080/rpc" });
 * const server = createMcpServer(routes, api.with({
 *   middleware: () => ({ headers: { authorization: `Bearer ${process.env.TOKEN}` } }),
 * }));
 * await server.connect(new StdioServerTransport());
 */
export declare function createMcpServer<T extends McpRoutes>(routes: (T & ToolRoutes<T>) | McpTool[], client: AnyClient, info?: McpServerInfo): Server;
/** @deprecated Reads the TypeScript source on every call; use `createMcpServer(routes, client)`. */
export declare function createMcpServer(filePath: string, variableName: string, options: McpOptions): Server;
/**
 * Serves your routes as MCP tools over stdio, the way agents start a local
 * MCP server.
 *
 * @example
 * // mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
 * serveMcp(routes, createClient<typeof routes>({ path: "http://localhost:8080/rpc" }));
 */
export declare function serveMcp<T extends McpRoutes>(routes: (T & ToolRoutes<T>) | McpTool[], client: AnyClient, info?: McpServerInfo): Promise<Server>;
/** @deprecated Use `serveMcp(routes, client)`. */
export declare function serveMcp(filePath: string, variableName: string, options: McpOptions): Promise<Server>;
/** The MCP server for a list of tools, which `load` gives for each request. */
export declare function toolServer(load: () => Promise<ServedTool[]>, info?: McpServerInfo): Server<{
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    method: string;
    params?: {
        [x: string]: unknown;
        _meta?: {
            [x: string]: unknown;
            progressToken?: string | number | undefined;
            "io.modelcontextprotocol/related-task"?: {
                taskId: string;
            } | undefined;
        } | undefined;
    } | undefined;
}, {
    [x: string]: unknown;
    _meta?: {
        [x: string]: unknown;
        progressToken?: string | number | undefined;
        "io.modelcontextprotocol/related-task"?: {
            taskId: string;
        } | undefined;
    } | undefined;
}>;
export {};
