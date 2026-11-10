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
  /** The route's place in the routes object, e.g. `["posts", "getPost"]`. */
  path: string[];
  tool: Tool;
};

/** The request parts a tool takes: whatever the route declares. */
export type Part = (typeof INPUTS)[number];

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
  const tools = routes.map((route) => ({
    method: route.method,
    path: route.name.split("."),
    tool: routeToTool(route),
  }));
  const seen = new Set<string>();
  for (const { tool } of tools) {
    if (seen.has(tool.name)) throw new Error(`Two routes become the tool "${tool.name}"`);
    seen.add(tool.name);
    // Claude and OpenAI cap tool names at 64 characters; some clients count the server's name too.
    if (tool.name.length > 64)
      console.warn(`[cuple-mcp] "${tool.name}" is over 64 characters`);
  }
  return tools;
}

/**
 * The request parts a tool takes. A route that needs `authorization` says so in
 * its tool, so the agent knows to log in and send the token.
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

/**
 * One tool per route: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 */
export function routeToTool(route: RouteInfo): Tool {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const input of INPUTS) {
    const schema = route[`${input}Schema`];
    if (schema === null) continue;
    properties[input] = forClients(convertSchemaToOpenAPI(withoutRefs(schema)));
    if (isRequired(schema)) required.push(input);
  }

  return {
    name: route.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
    description: route.description ?? describe(route),
    inputSchema: { type: "object", properties, required },
    // Without readOnlyHint, ChatGPT asks the user to confirm every call.
    annotations: {
      readOnlyHint: route.method === "get",
      destructiveHint: route.method === "delete",
    },
  };
}

/** For a route without `.meta({ description })`: better than nothing. */
function describe(route: RouteInfo) {
  // cuple's own results (bad input, a crash) are true of every route.
  const results = route.response.flatMap((r) =>
    r.result && r.result !== "unexpected-error" && !r.result.startsWith("invalid-")
      ? [r.result]
      : [],
  );
  const answers = results.length ? ` Answers ${[...new Set(results)].join(", ")}.` : "";
  return `${route.method.toUpperCase()} ${route.name}.${answers}`;
}

/**
 * Several clients handle `anyOf` but not `oneOf`, and see a union of literals
 * best as one `enum`.
 */
function forClients(schema: object): object {
  if (Array.isArray(schema)) return schema.map(forClients);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = typeof value === "object" && value !== null ? forClients(value) : value;
  }
  const variants = out.oneOf as Record<string, unknown>[] | undefined;
  if (!variants) return out;
  delete out.oneOf;
  const literals = variants.every(
    (v) =>
      Array.isArray(v.enum) && v.type === variants[0].type && Object.keys(v).length === 2,
  );
  return literals
    ? {
        ...out,
        type: variants[0].type,
        enum: variants.flatMap((v) => v.enum as unknown[]),
      }
    : { ...out, anyOf: variants };
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

/**
 * The tool with its inputs at the top level, `{ id, title }` rather than
 * `{ params: { id }, body: { title } }`: agents fill flat arguments more
 * reliably. `inputs` says which part each one goes back to. `null` when the
 * parts can't be merged: a key in two of them, or a part that isn't an object.
 */
export function flattened(
  tool: Tool,
): { tool: Tool; inputs: Record<string, Part> } | null {
  const schema = tool.inputSchema;
  const properties: Record<string, object> = {};
  const required: string[] = [];
  const inputs: Record<string, Part> = {};

  for (const [part, value] of Object.entries(schema.properties ?? {})) {
    const partSchema = value as {
      properties?: Record<string, object>;
      required?: string[];
    };
    if (!partSchema.properties) return null;
    for (const [key, keySchema] of Object.entries(partSchema.properties)) {
      if (key in inputs) return null;
      inputs[key] = part as Part;
      properties[key] = keySchema;
      const partRequired = schema.required?.includes(part) ?? false;
      if (partRequired && partSchema.required?.includes(key)) required.push(key);
    }
  }
  return {
    tool: { ...tool, inputSchema: { type: "object", properties, required } },
    inputs,
  };
}
