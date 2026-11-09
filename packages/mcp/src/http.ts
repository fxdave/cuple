import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { type McpOptions, serverFor } from "./server.js";
import { type McpTool, type McpToolsJson, withoutHeaders } from "./tools.js";

export type McpHttpOptions = Omit<McpOptions, "tsconfigPath"> & {
  /**
   * Headers of the MCP client's request to pass on to every call, e.g.
   * `["authorization"]`: the user configures their token once in their MCP
   * client, and your routes receive it as usual. The agent never sees these
   * headers: they are removed from the tools' inputs.
   */
  forwardHeaders?: string[];
};

/**
 * A remote MCP server (Streamable HTTP, stateless) as a request handler for
 * Express or `node:http`. It answers POST; other methods get 405.
 *
 * @param tools From {@link generateMcpTools}, usually written at build time by
 *   `cuple-mcp tools src/routes.ts routes > mcp-tools.json`.
 * @example
 * import tools from "./mcp-tools.json";
 *
 * app.all(
 *   "/mcp",
 *   createMcpHttpHandler(tools, {
 *     url: "http://localhost:8080/rpc",
 *     forwardHeaders: ["authorization"],
 *   }),
 * );
 */
export function createMcpHttpHandler(
  tools: McpTool[] | McpToolsJson,
  options: McpHttpOptions,
) {
  const all = tools as McpTool[];
  const forward = (options.forwardHeaders ?? []).map((name) => name.toLowerCase());
  const shown = forward.length
    ? all.map((entry) => ({ ...entry, tool: withoutHeaders(entry.tool, forward) }))
    : all;

  return async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const name of forward) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // Stateless: a fresh server and transport per request. Plain JSON replies
    // rather than SSE, so buffering proxies pass them through.
    const server = serverFor(shown, { ...options, headers });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      // A body parser that ran first has already read the stream.
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[cuple/mcp] request failed", e);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: ErrorCode.InternalError, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  };
}
