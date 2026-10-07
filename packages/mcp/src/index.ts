import { createClient, fetchCuple, type RecursiveApi } from "@cuple/client";
import { inspectRoutes, type RouteInfo, type Schema } from "@cuple/inspect";
import { convertSchemaToOpenAPI } from "@cuple/openapi";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
 * The request parts a tool takes: whatever the route declares. A route that
 * needs `authorization` says so in its tool, so the agent knows to log in and
 * send the token.
 */
const INPUTS = ["params", "query", "body", "headers"] as const;

/** One tool per route: its name, `.meta({ description })` and inputs. */
export function routeToTool(route: RouteInfo): Tool {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const input of INPUTS) {
    const schema = route[`${input}Schema`];
    if (schema === null) continue;
    properties[input] = convertSchemaToOpenAPI(schema);
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
  const routes = inspectRoutes(filePath, variableName, {
    tsconfigPath: options.tsconfigPath,
  });
  const byName = new Map(routes.map((route) => [route.name, route]));
  const client = createClient<RecursiveApi>({ path: options.url });

  const server = new Server(
    { name: options.name ?? "cuple", version: options.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: routes.map(routeToTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const route = byName.get(request.params.name);
    if (!route)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    const input = Object.fromEntries(INPUTS.map((key) => [key, args[key]]));
    try {
      const response = await fetchCuple(endpointOf(client, route), input);
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
function endpointOf(client: object, route: RouteInfo) {
  // The client is a Proxy, so every path exists.
  let endpoint: any = client;
  for (const segment of [...route.name.split("."), route.method]) {
    endpoint = endpoint[segment];
  }
  return endpoint;
}
