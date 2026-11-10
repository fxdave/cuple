import {
  inspectRoutes,
  type PropertyInfo,
  type RouteInfo,
  type Schema,
} from "@cuple/inspect";
import { convertSchemaToOpenAPI } from "@cuple/openapi";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * One route as an MCP tool, and the HTTP method to call it with. Plain data, so
 * a list of them can be written at build time and served where the TypeScript
 * sources are not. Make them with {@link generateMcpTools} or the
 * `cuple-mcp tools` command.
 */
export type McpTool = {
  method: string;
  tool: Tool;
};

/**
 * Reads your routes from the TypeScript source and returns one tool each.
 *
 * @param filePath The file that exports your routes, e.g. `"./src/routes.ts"`.
 * @param variableName The exported variable holding them, e.g. `"routes"`.
 * @example
 * // Usually run at build time, through the CLI, which writes a typed module:
 * //   cuple-mcp tools src/routes.ts routes > src/mcp-tools.ts
 * const tools = generateMcpTools("./src/routes.ts", "routes");
 */
export function generateMcpTools(
  filePath: string,
  variableName: string,
  options?: {
    /** Defaults to the nearest `tsconfig.json`. */
    tsconfigPath?: string;
  },
): McpTool[] {
  const { routes } = inspectRoutes(filePath, variableName, options);
  return routes.map((route) => ({ method: route.method, tool: routeToTool(route) }));
}

/**
 * The request parts a tool takes: whatever the route declares. A route that
 * needs `authorization` says so in its tool, so the agent knows to log in and
 * send the token.
 */
export const INPUTS = ["params", "query", "body", "headers"] as const;

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

/** The request parts a client injects, e.g. `{ headers: { authorization: "…" } }`. */
export type Injected = Partial<Record<(typeof INPUTS)[number], unknown>>;

/**
 * The tool without what the client injects: those inputs are the server's to
 * send, so the agent neither sees nor sends them. A part goes entirely when
 * nothing is left of it, or when the client injects it whole.
 */
export function withoutInjected(tool: Tool, injected: Injected): Tool {
  const schema = tool.inputSchema;
  const properties = { ...schema.properties };
  let required = schema.required ?? [];

  for (const part of INPUTS) {
    const value = injected[part];
    if (value === undefined || !(part in properties)) continue;
    const partSchema = properties[part] as {
      properties?: Record<string, object>;
      required?: string[];
    };
    const keys = isObject(value) ? Object.keys(value) : null;
    const left = keys
      ? Object.entries(partSchema.properties ?? {}).filter(([key]) => !keys.includes(key))
      : [];
    if (left.length === 0) {
      delete properties[part];
      required = required.filter((key) => key !== part);
      continue;
    }
    const partRequired = (partSchema.required ?? []).filter(
      (key) => !keys?.includes(key),
    );
    properties[part] = {
      ...partSchema,
      properties: Object.fromEntries(left),
      required: partRequired,
    };
    if (partRequired.length === 0) required = required.filter((key) => key !== part);
  }

  return { ...tool, inputSchema: { ...schema, properties, required } };
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
