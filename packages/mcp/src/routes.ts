import type { BuiltEndpoint, EndpointSchema } from "@cuple/server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, type ZodType } from "zod";
import { forClients, INPUTS, isObject } from "./tools.js";

/** What an endpoint has at runtime. */
type AnyEndpoint = Pick<
  BuiltEndpoint<object, unknown, "get", unknown>,
  "_handler" | "_kind" | "_meta" | "_inputs" | "_rawBody" | "_invoke"
> & { _method: string };

/** Routes as `initRpc` takes them: endpoints, in groups as deep as you like. */
export type McpRoutes = object;

/**
 * The routes, with every endpoint an MCP tool can't be turned into its reason,
 * so passing one is a type error that says why.
 */
export type ToolRoutes<T> = {
  [K in keyof T]: T[K] extends { tKind: infer Kind }
    ? [Kind] extends ["json"]
      ? T[K] extends { tInput: { body: Buffer | Blob } }
        ? "rawBody() endpoints can't be MCP tools: an agent sends JSON"
        : T[K]
      : [Kind] extends ["sse"]
        ? "SSE endpoints can't be MCP tools: a tool call has one result"
        : "Raw endpoints can't be MCP tools: they answer through res"
    : ToolRoutes<T[K]>;
};

/** One endpoint as a tool. */
export type RouteTool = { tool: Tool; path: string[]; endpoint: AnyEndpoint };

const isEndpoint = (value: unknown): value is AnyEndpoint =>
  isObject(value) && typeof value._handler === "function";

/**
 * One tool per endpoint: `posts.getPost` is `posts_getPost` (Claude's and
 * OpenAI's APIs reject dots), described by `.meta({ description })`.
 *
 * @param skipInputs How many of each endpoint's schemas to leave out: those its
 *   chain validated before the tool is called.
 */
export function routeTools(routes: McpRoutes, skipInputs = 0): RouteTool[] {
  const tools: RouteTool[] = [];
  const walk = (node: object, path: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      if (isEndpoint(value)) tools.push(routeTool([...path, key], value, skipInputs));
      else if (isObject(value)) walk(value, [...path, key]);
    }
  };
  walk(routes, []);

  const seen = new Set<string>();
  for (const { tool } of tools) {
    if (seen.has(tool.name)) throw new Error(`Two routes become the tool "${tool.name}"`);
    seen.add(tool.name);
    // Claude and OpenAI cap tool names at 64 characters; some clients count the server's name too.
    if (tool.name.length > 64)
      console.warn(`[cuple/mcp] "${tool.name}" is over 64 characters`);
  }
  return tools;
}

function routeTool(path: string[], endpoint: AnyEndpoint, skipInputs: number): RouteTool {
  const name = path.join("_").replace(/[^a-zA-Z0-9_-]/g, "_");
  const route = path.join(".");
  if (!endpoint._inputs)
    throw new Error(`${route}: built by an older @cuple/server; MCP needs 2.6 or later`);
  if (endpoint._kind === "sse" || (endpoint as { _sse?: true })._sse)
    throw new Error(
      `${route}: SSE endpoints can't be MCP tools, a tool call has one result`,
    );
  if (endpoint._kind !== "json" || !endpoint._invoke)
    throw new Error(
      `${route}: raw endpoints can't be MCP tools, they answer through res`,
    );
  if (endpoint._rawBody)
    throw new Error(
      `${route}: rawBody() endpoints can't be MCP tools, an agent sends JSON`,
    );

  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const part of INPUTS) {
    const schemas = endpoint._inputs
      .slice(skipInputs)
      .filter((input: EndpointSchema) => input.part === part)
      .map((input: EndpointSchema) => jsonSchema(input.schema, `${route} ${part}`));
    if (!schemas.length) continue;
    const schema = merged(schemas);
    properties[part] = forClients(schema);
    if (isRequired(schema)) required.push(part);
  }

  const meta = (endpoint._meta ?? {}) as Record<string, unknown>;
  const description = typeof meta.description === "string" ? meta.description : undefined;
  if (!description)
    console.warn(
      `[cuple/mcp] ${route} has no .meta({ description }) to tell agents what it's for`,
    );

  return {
    path,
    endpoint,
    tool: {
      name,
      description: description ?? `${endpoint._method.toUpperCase()} ${route}.`,
      inputSchema: { type: "object", properties, required },
      // Without readOnlyHint, ChatGPT asks the user to confirm every call. A POST
      // that only reads says so with .meta({ readOnly: true }).
      annotations: {
        readOnlyHint: flag(meta.readOnly) ?? endpoint._method === "get",
        destructiveHint: flag(meta.destructive) ?? endpoint._method === "delete",
      },
    },
  };
}

const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

/** What the agent may send: the schema's input side. */
function jsonSchema(schema: ZodType, where: string): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    json = toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
  } catch {
    console.warn(`[cuple/mcp] ${where}: part of the schema can't be told to agents`);
    json = toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  }
  return withoutRefs(json) as Record<string, unknown>;
}

/**
 * Clients rewrite tool schemas for their provider and disagree about `$ref`,
 * so a recursive part says nothing rather than carry a pointer they may drop.
 * The endpoint validates the arguments anyway.
 */
function withoutRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRefs);
  if (!isObject(value)) return value;
  if ("$ref" in value) return {};
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "$schema" || key === "$defs") continue;
    out[key] = withoutRefs(inner);
  }
  return out;
}

/** A link's schema and the route's own for the same part, as one. */
function merged(schemas: Record<string, unknown>[]): Record<string, unknown> {
  if (schemas.length === 1) return schemas[0];
  if (!schemas.every((schema) => schema.type === "object")) return { allOf: schemas };
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  for (const schema of schemas) {
    Object.assign(properties, schema.properties);
    for (const key of (schema.required as string[] | undefined) ?? []) required.add(key);
  }
  return { type: "object", properties, required: [...required] };
}

/** An object is optional when every one of its fields is. */
function isRequired(schema: Record<string, unknown>) {
  if (schema.type !== "object") return true;
  return ((schema.required as string[] | undefined) ?? []).length > 0;
}
