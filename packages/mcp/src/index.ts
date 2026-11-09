import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient, fetchCuple, type RecursiveApi } from "@cuple/client";
import {
  inspectRoutes,
  type PropertyInfo,
  type RouteInfo,
  type Schema,
} from "@cuple/inspect";
import { convertSchemaToOpenAPI } from "@cuple/openapi";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

export type McpOptions = {
  /** Your server's RPC endpoint, e.g. `http://localhost:8080/rpc`. */
  url: string;
  /** Defaults to the nearest `tsconfig.json`. */
  tsconfigPath?: string;
  /** How the server introduces itself to the agent. Default: `"cuple"`. */
  name?: string;
  version?: string;
};

/**
 * A route as a tool, plus what it takes to call it: the output of
 * {@link generateMcpTools}, plain JSON, so it can be written at build time and
 * served where the TypeScript sources are not.
 */
export type McpTool = {
  method: string;
  tool: Tool;
};

/**
 * The request parts a tool takes: whatever the route declares. A route that
 * needs `authorization` says so in its tool, so the agent knows to log in and
 * send the token.
 */
const INPUTS = ["params", "query", "body", "headers"] as const;

/**
 * A tool's `inputSchema` is JSON Schema, which has `$defs`/`$ref`, but an agent
 * reaches it through a client that usually rewrites it into a provider's
 * function-calling schema, and those disagree about `$ref` — some resolve it,
 * some ignore it, some reject the tool. A pointer the client drops is worse than
 * no constraint at all, whereas `{}` is a schema every client accepts and the
 * call still goes through the RPC endpoint, which type-checks the arguments
 * properly anyway.
 *
 * So the names stay in the OpenAPI document, and a tool says nothing about the
 * shape it could not describe. It costs little: inputs come from zod schemas,
 * and a recursive one (`z.lazy`) does not survive extraction to begin with.
 */
function withoutRefs(schema: Schema): Schema {
  switch (schema.type) {
    case "ref":
      return { type: "unknown" };
    case "array":
      return { type: "array", items: withoutRefs(schema.items) };
    case "union":
      return { type: "union", variants: schema.variants.map(withoutRefs) };
    case "object": {
      const properties: Record<string, PropertyInfo> = {};
      for (const [key, info] of Object.entries(schema.properties)) {
        properties[key] = { schema: withoutRefs(info.schema), required: info.required };
      }
      return { type: "object", properties };
    }
    default:
      return schema;
  }
}

/** One tool per route: its name, `.meta({ description })` and inputs. */
export function routeToTool(route: RouteInfo): Tool {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const input of INPUTS) {
    const schema = route[`${input}Schema`];
    if (schema === null) continue;
    properties[input] = convertSchemaToOpenAPI(withoutRefs(schema));
    if (isRequired(schema)) required.push(input);
  }

  return {
    name: route.name,
    description: route.description,
    inputSchema: { type: "object", properties, required },
  };
}

/** An object is optional when every one of its fields is. */
function isRequired(schema: Schema) {
  if (schema.type !== "object") return true;
  return Object.values(schema.properties).some((property) => property.required);
}

/**
 * Serves your routes as MCP tools over stdio, the way agents start a local
 * MCP server:
 *
 * ```ts
 * serveMcp("./src/routes.ts", "routes", { url: "http://localhost:8080/rpc" });
 * ```
 *
 * `variableName` is the exported variable that holds your routes, as for
 * `generateOpenAPI`.
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

/** One {@link McpTool} per route, for {@link createMcpServerFromTools}. */
export function generateMcpTools(
  filePath: string,
  variableName: string,
  options?: { tsconfigPath?: string },
): McpTool[] {
  const { routes } = inspectRoutes(filePath, variableName, options);
  return routes.map((route) => ({ method: route.method, tool: routeToTool(route) }));
}

/**
 * The MCP server {@link serveMcp} runs, not yet connected: for another
 * transport, or a test.
 *
 * Calls go through the RPC endpoint rather than the REST path, so routes
 * without `.path()` are tools too.
 */
export function createMcpServer(
  filePath: string,
  variableName: string,
  options: McpOptions,
) {
  const tools = generateMcpTools(filePath, variableName, {
    tsconfigPath: options.tsconfigPath,
  });
  return createMcpServerFromTools(tools, options);
}

export type McpServerOptions = Omit<McpOptions, "tsconfigPath"> & {
  /** Sent on every call, over whatever headers the agent passed. */
  headers?: Record<string, string>;
};

/** {@link createMcpServer} for tools generated beforehand. */
export function createMcpServerFromTools(tools: McpTool[], options: McpServerOptions) {
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

/**
 * The tool without the given headers: the server supplies them, so the agent
 * neither sees nor sends them. `headers` goes when nothing is left of it.
 */
export function withoutHeaders(tool: Tool, names: string[]): Tool {
  const schema = tool.inputSchema;
  const headers = schema.properties?.headers as
    | { properties?: Record<string, object>; required?: string[] }
    | undefined;
  if (!headers?.properties) return tool;

  const properties = Object.fromEntries(
    Object.entries(headers.properties).filter(([key]) => !names.includes(key)),
  );
  const required = (headers.required ?? []).filter((key) => !names.includes(key));
  const { headers: _, ...rest } = schema.properties!;
  const keep = Object.keys(properties).length > 0;

  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: keep
        ? { ...rest, headers: { ...headers, properties, required } }
        : rest,
      required: (schema.required ?? []).filter(
        (key) => key !== "headers" || required.length > 0,
      ),
    },
  };
}

export type McpHttpOptions = McpServerOptions & {
  /**
   * Request headers passed on to every call, e.g. `["authorization"]`, so the
   * client's credentials reach the routes without the agent handling them.
   * They are removed from the tools' inputs.
   */
  forwardHeaders?: string[];
};

/**
 * A stateless Streamable HTTP MCP endpoint, for `app.post(path, handler)`.
 * Pass the parsed JSON body as `req.body` when a body parser runs first.
 */
export function createMcpHttpHandler(tools: McpTool[], options: McpHttpOptions) {
  const forward = (options.forwardHeaders ?? []).map((name) => name.toLowerCase());
  const shown = forward.length
    ? tools.map((entry) => ({ ...entry, tool: withoutHeaders(entry.tool, forward) }))
    : tools;

  return async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
    const headers: Record<string, string> = { ...options.headers };
    for (const name of forward) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    // Stateless mode needs a fresh server and transport per request.
    const server = createMcpServerFromTools(shown, { ...options, headers });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
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

/** `posts.getPost` + `get` is `client.posts.getPost.get`. */
function endpointOf(client: object, name: string, method: string) {
  // The client is a Proxy, so every path exists.
  let endpoint: any = client;
  for (const segment of [...name.split("."), method]) {
    endpoint = endpoint[segment];
  }
  return endpoint;
}
