import { createClient, fetchCuple, type RecursiveApi } from "@cuple/client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { type McpRoutes, routeTools, type ToolRoutes } from "./routes.js";
import {
  flattened,
  generateMcpTools,
  INPUTS,
  type Injected,
  isObject,
  type McpTool,
  type Part,
  withoutInjected,
} from "./tools.js";

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
export function createMcpServer<T extends McpRoutes>(
  routes: (T & ToolRoutes<T>) | McpTool[],
  client: AnyClient,
  info?: McpServerInfo,
): Server;
/** @deprecated Reads the TypeScript source on every call; use `createMcpServer(routes, client)`. */
export function createMcpServer(
  filePath: string,
  variableName: string,
  options: McpOptions,
): Server;
export function createMcpServer(
  routesOrFile: McpRoutes | McpTool[] | string,
  clientOrVariable: AnyClient | string,
  options?: McpServerInfo | McpOptions,
) {
  if (typeof routesOrFile === "string") {
    const legacy = options as McpOptions;
    const tools = generateMcpTools(routesOrFile, clientOrVariable as string, {
      tsconfigPath: legacy.tsconfigPath,
    });
    return clientServer(tools, createClient<RecursiveApi>({ path: legacy.url }), legacy);
  }
  const tools = Array.isArray(routesOrFile)
    ? routesOrFile
    : routeTools(routesOrFile).map(({ tool, path, endpoint }) => ({
        tool,
        path,
        method: endpoint._method as string,
      }));
  return clientServer(tools, clientOrVariable as AnyClient, options);
}

/**
 * Serves your routes as MCP tools over stdio, the way agents start a local
 * MCP server.
 *
 * @example
 * // mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
 * serveMcp(routes, createClient<typeof routes>({ path: "http://localhost:8080/rpc" }));
 */
export async function serveMcp<T extends McpRoutes>(
  routes: (T & ToolRoutes<T>) | McpTool[],
  client: AnyClient,
  info?: McpServerInfo,
): Promise<Server>;
/** @deprecated Use `serveMcp(routes, client)`. */
export async function serveMcp(
  filePath: string,
  variableName: string,
  options: McpOptions,
): Promise<Server>;
export async function serveMcp(...args: [any, any, any?]) {
  const server = (createMcpServer as (...a: unknown[]) => Server)(...args);
  await server.connect(new StdioServerTransport());
  return server;
}

function clientServer(tools: McpTool[], client: AnyClient, info?: McpServerInfo) {
  return toolServer(async () => {
    // Read on every request: the middleware may hand out a fresh token.
    const hidden = ((await (client as any).clientProps.middleware?.()) ?? {}) as Injected;
    return tools.map((entry) => ({
      tool: entry.tool,
      hidden,
      call: (input) => fetchCuple(endpointOf(client, entry.path, entry.method), input),
    }));
  }, info);
}

/** The MCP server for a list of tools, which `load` gives for each request. */
export function toolServer(load: () => Promise<ServedTool[]>, info?: McpServerInfo) {
  /** What the agent sees: without the hidden inputs, flat where possible. */
  const offered = ({ tool, hidden }: ServedTool) => {
    const visible = withoutInjected(tool, hidden);
    return (info?.flatten ?? true)
      ? (flattened(visible) ?? { tool: visible })
      : { tool: visible };
  };

  const server = new Server(
    { name: info?.name ?? "cuple", version: info?.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await load()).map((entry) => offered(entry).tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = (await load()).find((e) => e.tool.name === request.params.name);
    if (!entry)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const given = partsOf(request.params.arguments ?? {}, offered(entry));
    // Merge each part: the hidden keys win, and parts the agent left out stay out.
    const input: Injected = {};
    for (const part of INPUTS) {
      const own = entry.hidden[part];
      const value =
        isObject(given[part]) && isObject(own)
          ? { ...given[part], ...own }
          : (own ?? given[part]);
      if (value !== undefined) input[part] = value;
    }
    try {
      const response = (await entry.call(input)) as Record<string, unknown>;
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
        ...(isObject(response) && { structuredContent: response }),
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

/**
 * The agent's arguments as request parts. Agents sometimes send an object as
 * its JSON text, so a string where the schema wants an object is parsed.
 */
function partsOf(
  args: Record<string, unknown>,
  shown: { tool: Tool; inputs?: Record<string, Part> },
): Partial<Record<Part, unknown>> {
  const schemas = (shown.tool.inputSchema.properties ?? {}) as Record<
    string,
    { type?: string }
  >;
  const value = (key: string) => {
    const given = args[key];
    const wants = schemas[key]?.type;
    if (typeof given !== "string" || (wants !== "object" && wants !== "array"))
      return given;
    try {
      return JSON.parse(given);
    } catch {
      return given;
    }
  };
  if (!shown.inputs) return Object.fromEntries(INPUTS.map((part) => [part, value(part)]));

  const parts: Partial<Record<Part, Record<string, unknown>>> = {};
  for (const [key, part] of Object.entries(shown.inputs)) {
    if (args[key] === undefined) continue;
    parts[part] ??= {};
    parts[part][key] = value(key);
  }
  return parts;
}

/** `["posts", "getPost"]` + `get` is `client.posts.getPost.get`. */
function endpointOf(client: object, path: string[], method: string) {
  // The client is a Proxy, so every path exists.
  let endpoint: any = client;
  for (const segment of [...path, method]) {
    endpoint = endpoint[segment];
  }
  return endpoint;
}
