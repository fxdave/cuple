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
export async function serveMcp(...args: [any, any, any?]) {
  const server = (createMcpServer as (...a: unknown[]) => Server)(...args);
  await server.connect(new StdioServerTransport());
  return server;
}

function serverFor(tools: McpTool[], client: AnyClient, info?: McpServerInfo) {
  const byName = new Map(tools.map((entry) => [entry.tool.name, entry]));
  const injected = async (): Promise<Injected> =>
    ((await (client as any).clientProps.middleware?.()) ?? {}) as Injected;
  /** What the agent sees: without the injected inputs, flat where possible. */
  const offered = (tool: Tool, hidden: Injected) => {
    const visible = withoutInjected(tool, hidden);
    return (info?.flatten ?? true)
      ? (flattened(visible) ?? { tool: visible })
      : { tool: visible };
  };

  const server = new Server(
    { name: info?.name ?? "cuple", version: info?.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const hidden = await injected();
    return { tools: tools.map((entry) => offered(entry.tool, hidden).tool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = byName.get(request.params.name);
    if (!entry)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const hidden = await injected();
    const shown = offered(entry.tool, hidden);
    const given = partsOf(request.params.arguments ?? {}, shown);
    // The client merges its own data shallowly under these, so merge each part
    // here: the injected keys win, and parts the agent left out stay out.
    const input: Record<string, unknown> = {};
    for (const part of INPUTS) {
      const own = hidden[part];
      const value =
        isObject(given[part]) && isObject(own)
          ? { ...given[part], ...own }
          : (own ?? given[part]);
      if (value !== undefined) input[part] = value;
    }
    try {
      const response = await fetchCuple(
        endpointOf(client, entry.path, entry.method),
        input,
      );
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
