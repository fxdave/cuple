import { createClient, fetchCuple, type RecursiveApi } from "@cuple/client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { generateMcpTools, INPUTS, type McpTool } from "./tools.js";

export type McpOptions = {
  /** Your server's RPC endpoint, which the tools call, e.g. `"http://localhost:8080/rpc"`. */
  url: string;
  /** Defaults to the nearest `tsconfig.json`. */
  tsconfigPath?: string;
  /** How the server introduces itself to the agent. Default: `"cuple"`. */
  name?: string;
  /** Default: `"1.0.0"`. */
  version?: string;
};

/**
 * Serves your routes as MCP tools over stdin/stdout, the way agents start a
 * local MCP server. For a remote server, see `createMcpHttpHandler`.
 *
 * @param filePath The file that exports your routes, e.g. `"./src/routes.ts"`.
 * @param variableName The exported variable holding them, e.g. `"routes"`.
 * @example
 * // mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
 * serveMcp("./src/routes.ts", "routes", { url: "http://localhost:8080/rpc" });
 */
export async function serveMcp(
  filePath: string,
  variableName: string,
  options: McpOptions,
) {
  const server = createMcpServer(filePath, variableName, options);
  await server.connect(new StdioServerTransport());
  return server;
}

/**
 * The MCP server {@link serveMcp} runs, not connected yet: for a transport of
 * your own, or a test. Calls go through the RPC endpoint rather than REST
 * paths, so routes without `.path()` are tools too.
 */
export function createMcpServer(
  filePath: string,
  variableName: string,
  options: McpOptions,
) {
  const tools = generateMcpTools(filePath, variableName, {
    tsconfigPath: options.tsconfigPath,
  });
  return serverFor(tools, options);
}

/** `headers` are sent on every call, over whatever headers the agent passed. */
export function serverFor(
  tools: McpTool[],
  options: Omit<McpOptions, "tsconfigPath"> & { headers?: Record<string, string> },
) {
  const byName = new Map(tools.map((entry) => [entry.tool.name, entry]));
  const client = createClient<RecursiveApi>({ path: options.url });

  const server = new Server(
    { name: options.name ?? "cuple", version: options.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((entry) => entry.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = byName.get(request.params.name);
    if (!entry)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    const input: Record<string, unknown> = Object.fromEntries(
      INPUTS.map((key) => [key, args[key]]),
    );
    if (options.headers) {
      input.headers = { ...(args.headers as object | undefined), ...options.headers };
    }
    try {
      const response = await fetchCuple(
        endpointOf(client, entry.tool.name, entry.method),
        input,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
        isError: response.result !== "success",
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: (e as Error).message }],
        isError: true,
      };
    }
  });

  return server;
}

/** `posts.getPost` + `get` is `client.posts.getPost.get`. */
function endpointOf(client: object, name: string, method: string) {
  // The client is a Proxy, so every path exists.
  let endpoint: any = client;
  for (const segment of [...name.split("."), method]) {
    endpoint = endpoint[segment];
  }
  return endpoint;
}
