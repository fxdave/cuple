import { type Client, createClient, fetchCuple, type RecursiveApi } from "@cuple/client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  generateMcpTools,
  INPUTS,
  type Injected,
  isObject,
  type McpTool,
  withoutInjected,
} from "./tools.js";

type AnyClient = Client<RecursiveApi, any>;

export type McpServerInfo = {
  /** How the server introduces itself to the agent. Default: `"cuple"`. */
  name?: string;
  /** Default: `"1.0.0"`. */
  version?: string;
};

/** @deprecated The options of `createMcpServer(filePath, variableName, options)`. */
export type McpOptions = McpServerInfo & {
  /** Your server's RPC endpoint, which the tools call, e.g. `"http://localhost:8080/rpc"`. */
  url: string;
  /** Defaults to the nearest `tsconfig.json`. */
  tsconfigPath?: string;
};

/**
 * An MCP server whose tools call your routes through `client`, not connected
 * yet: give it any transport from `@modelcontextprotocol/sdk`, or use
 * `handleMcpRequest` for HTTP.
 *
 * What the client's `with({ middleware })` injects (a token, a tenant) goes
 * with every call and is hidden from the agent.
 *
 * @param tools From `cuple-mcp tools src/routes.ts routes > src/mcp-tools.ts`.
 * @example
 * const api = createClient<typeof routes>({ path: "http://localhost:8080/rpc" });
 * const server = createMcpServer(tools, api.with({
 *   middleware: () => ({ headers: { authorization: `Bearer ${process.env.TOKEN}` } }),
 * }));
 * await server.connect(new StdioServerTransport());
 */
export function createMcpServer(
  tools: McpTool[],
  client: AnyClient,
  info?: McpServerInfo,
): Server;
/** @deprecated Reads the TypeScript source on every call; use `createMcpServer(tools, client)`. */
export function createMcpServer(
  filePath: string,
  variableName: string,
  options: McpOptions,
): Server;
export function createMcpServer(
  toolsOrFile: McpTool[] | string,
  clientOrVariable: AnyClient | string,
  options?: McpServerInfo | McpOptions,
) {
  if (typeof toolsOrFile === "string") {
    const legacy = options as McpOptions;
    const tools = generateMcpTools(toolsOrFile, clientOrVariable as string, {
      tsconfigPath: legacy.tsconfigPath,
    });
    return serverFor(tools, createClient<RecursiveApi>({ path: legacy.url }), legacy);
  }
  return serverFor(toolsOrFile, clientOrVariable as AnyClient, options);
}

/**
 * Serves your routes as MCP tools over stdio, the way agents start a local
 * MCP server.
 *
 * @example
 * // mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
 * serveMcp(tools, createClient<typeof routes>({ path: "http://localhost:8080/rpc" }));
 */
export async function serveMcp(
  tools: McpTool[],
  client: AnyClient,
  info?: McpServerInfo,
): Promise<Server>;
/** @deprecated Use `serveMcp(tools, client)`. */
export async function serveMcp(
  filePath: string,
  variableName: string,
  options: McpOptions,
): Promise<Server>;
export async function serveMcp(
  ...args: [any, any, any?]
) {
  const server = (createMcpServer as (...a: unknown[]) => Server)(...args);
  await server.connect(new StdioServerTransport());
  return server;
}

function serverFor(tools: McpTool[], client: AnyClient, info?: McpServerInfo) {
  const byName = new Map(tools.map((entry) => [entry.tool.name, entry]));
  const injected = async (): Promise<Injected> =>
    ((await (client as any).clientProps.middleware?.()) ?? {}) as Injected;

  const server = new Server(
    { name: info?.name ?? "cuple", version: info?.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const hidden = await injected();
    return { tools: tools.map((entry) => withoutInjected(entry.tool, hidden)) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = byName.get(request.params.name);
    if (!entry)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    const hidden = await injected();
    // The client merges its own data shallowly under these, so merge each part
    // here: the injected keys win, and parts the agent left out stay out.
    const input: Record<string, unknown> = {};
    for (const part of INPUTS) {
      const given = args[part];
      const own = hidden[part];
      const value =
        isObject(given) && isObject(own) ? { ...given, ...own } : (own ?? given);
      if (value !== undefined) input[part] = value;
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
