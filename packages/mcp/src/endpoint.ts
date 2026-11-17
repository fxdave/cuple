import type { Builder } from "@cuple/server";
import type { Request } from "express";
import { handleMcpRequest } from "./http.js";
import { type McpRoutes, routeTools, type ToolRoutes } from "./routes.js";
import { type McpServerInfo, type ServedTool, toolServer } from "./server.js";
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
    inject: (props: { data: DataOf<B>; req: Request }) => Promise<Injected>;
  };
  /** Which tools this caller gets. Default: all. */
  visible?: (props: { data: DataOf<B>; name: string }) => boolean;
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
export function createMcpEndpoint<
  B extends Builder<any>,
  T extends McpRoutes = {},
  P extends McpRoutes = {},
>(
  builder: B,
  options: McpEndpointOptions<B, T, P> & { tools?: (builder: B) => ToolRoutes<T> },
) {
  const chain = builder._chain;
  // Without a path, the tools aren't registered as HTTP routes of their own.
  const ownTools = (options.tools?.(builder.path("") as B) ?? {}) as T;
  const own = routeTools(ownTools, chain.inputs);
  const borrowed = options.routes ? routeTools(options.routes.pick as P) : [];
  const names = new Set(own.map(({ tool }) => tool.name));
  for (const { tool } of borrowed) {
    if (names.has(tool.name))
      throw new Error(`Two routes become the tool "${tool.name}"`);
  }

  const mcp = builder.postRaw(async ({ req, res, data: response }: any) => {
    if (!response.next) {
      const { next, statusCode, ...rest } = response;
      if (statusCode === 401)
        res.set("WWW-Authenticate", options.wwwAuthenticate ?? "Bearer");
      res.status(statusCode).json(rest);
      return;
    }
    const { next, ...data } = response;
    const hidden = options.routes ? await options.routes.inject({ data, req }) : {};
    const served: ServedTool[] = [
      ...own.map(({ tool, endpoint }) => ({
        tool,
        hidden: {},
        call: (input: Injected) =>
          endpoint._invoke!(input, { req, skip: chain.middlewares, data }),
      })),
      ...borrowed.map(({ tool, endpoint }) => ({
        tool,
        hidden,
        call: (input: Injected) => endpoint._invoke!(input, { req }),
      })),
    ].filter(({ tool }) => options.visible?.({ data, name: tool.name }) ?? true);

    await handleMcpRequest(
      toolServer(async () => served, options),
      req,
      res,
    );
  });
  // Stateless: no event stream to open and no session to end.
  for (const method of ["getRaw", "deleteRaw"] as const) {
    builder[method](async ({ res }: any) => {
      res.status(405).set("Allow", "POST").end();
    });
  }

  return { mcp, tools: ownTools, routes: (options.routes?.pick ?? {}) as P };
}
