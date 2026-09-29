import { fetchCuple } from "@cuple/client";
import type { RouteInfo, Schema } from "@cuple/inspect";
import { convertSchemaToOpenAPI } from "@cuple/openapi";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

export type CreateCupleMcpServerOptions = {
  /** From `inspectRoutes`. */
  routes: RouteInfo[];
  /**
   * The client the tools call through. Headers are its job — set them with
   * `client.with({ middleware })` — so the model can never send or override
   * them.
   */
  client: object;
  name?: string;
  version?: string;
};

/** The request parts a tool takes. Headers are left to the client. */
const INPUTS = ["params", "query", "body"] as const;

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
 * Calls go through the RPC endpoint rather than the REST path, so routes
 * without `.path()` are tools too.
 */
export function createCupleMcpServer(options: CreateCupleMcpServerOptions) {
  const server = new Server(
    { name: options.name ?? "cuple", version: options.version ?? "1.0.0" },
    { capabilities: { tools: {} } },
  );
  const routes = new Map(options.routes.map((route) => [route.name, route]));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: options.routes.map(routeToTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const route = routes.get(request.params.name);
    if (!route)
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    const input = Object.fromEntries(INPUTS.map((key) => [key, args[key]]));
    try {
      const response = await fetchCuple(endpointOf(options.client, route), input);
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
