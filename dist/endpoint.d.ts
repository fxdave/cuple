import type { Builder } from "@cuple/server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Request } from "express";
import { type McpRoutes, type ToolRoutes } from "./routes.js";
import { type McpServerInfo } from "./server.js";
import type { Injected } from "./tools.js";
/** What the endpoint's chain gave a request it let through. */
type DataOf<B> = B extends Builder<infer P> ? P["tData"] : never;
export type McpEndpointOptions<B, T, P> = McpServerInfo & {
    /**
     * Tools of the MCP endpoint's own, built on its builder: they run after its
     * chain, so they see what it gave (`data.authData`, …) and take no
     * credentials from the agent.
     */
    tools?: (builder: B) => T;
    /** Routes made for other clients, offered as tools too. */
    routes?: {
        /** Exactly the routes to offer: an agent reaches nothing else through MCP. */
        pick: P & ToolRoutes<P>;
        /**
         * What these routes take for the caller, made from what the MCP endpoint's
         * chain gave: a token they accept, a tenant id. Runs once per MCP request;
         * the keys it returns are hidden from the tools, and win over the agent's.
         */
        inject: (props: {
            data: DataOf<B>;
            req: Request;
        }) => Promise<Injected>;
    };
    /**
     * Takes all tools and returns the ones this caller gets, per MCP request:
     * drop the ones they can't use, or tell them how to (`description: "… Needs
     * the Pro plan."`). The agent can call only these. Tools are matched to their
     * routes by name.
     */
    toolListMiddleware?: (props: {
        data: DataOf<B>;
        tools: Tool[];
    }) => Promise<Tool[]>;
    /**
     * Sent with a 401 from the chain. MCP clients start OAuth from it; without
     * `resource_metadata` they look for it at the well-known URL. Default: `"Bearer"`.
     */
    wwwAuthenticate?: string;
};
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
export declare function createMcpEndpoint<B extends Builder<any>, T extends McpRoutes = {}, P extends McpRoutes = {}>(builder: B, options: McpEndpointOptions<B, T, P> & {
    tools?: (builder: B) => ToolRoutes<T>;
}): {
    mcp: import("@cuple/server").BuiltEndpoint<any, any, any, any, "raw">;
    tools: T;
    routes: P;
};
export {};
