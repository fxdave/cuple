import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
export declare function handleMcpRequest(server: Server, req: IncomingMessage & {
    body?: unknown;
}, res: ServerResponse): Promise<void>;
