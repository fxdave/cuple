import type { BuiltEndpoint } from "@cuple/server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
/** What an endpoint has at runtime. */
type AnyEndpoint = Pick<BuiltEndpoint<object, unknown, "get", unknown>, "_handler" | "_kind" | "_meta" | "_inputs" | "_rawBody" | "_invoke"> & {
    _method: string;
};
/** Routes as `initRpc` takes them: endpoints, in groups as deep as you like. */
export type McpRoutes = object;
/**
 * The routes, with every endpoint an MCP tool can't be turned into its reason,
 * so passing one is a type error that says why.
 */
export type ToolRoutes<T> = {
    [K in keyof T]: T[K] extends {
        tKind: infer Kind;
    } ? [Kind] extends ["json"] ? T[K] extends {
        tInput: {
            body: Buffer | Blob;
        };
    } ? "rawBody() endpoints can't be MCP tools: an agent sends JSON" : T[K] : [Kind] extends ["sse"] ? "SSE endpoints can't be MCP tools: a tool call has one result" : "Raw endpoints can't be MCP tools: they answer through res" : ToolRoutes<T[K]>;
};
/** One endpoint as a tool. */
export type RouteTool = {
    tool: Tool;
    path: string[];
    endpoint: AnyEndpoint;
};
/**
 * One tool per endpoint: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 *
 * @param skipInputs How many of each endpoint's schemas to leave out: those its
 *   chain validated before the tool is called.
 */
export declare function routeTools(routes: McpRoutes, skipInputs?: number): RouteTool[];
export {};
