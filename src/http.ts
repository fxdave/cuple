import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Answers one MCP request over Streamable HTTP, statelessly, with a server
 * made for it. Call it from your own route, where you know who is asking.
 *
 * Replies are plain JSON rather than SSE, so buffering proxies pass them.
 *
 * @example
 * mcp: builder
 *   .path("/mcp")
 *   .chain(authLink)
 *   .postRaw(async ({ req, res, data }) => {
 *     const client = api.with({ middleware: () => ({ headers: { authorization: req.headers.authorization } }) });
 *     await handleMcpRequest(createMcpServer(tools, client), req, res);
 *   }),
 */
export async function handleMcpRequest(
  server: Server,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
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
}
