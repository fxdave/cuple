// Schema representation - discriminated union
export type Schema =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "literal"; value: string | number | boolean }
  | { type: "array"; items: Schema }
  | { type: "object"; properties: Record<string, PropertyInfo> }
  | { type: "union"; variants: Schema[] }
  /**
   * A named definition, held in {@link InspectResult.definitions}. Emitted
   * where the walk closes a cycle, so a recursive type is described once and
   * pointed at instead of being cut off.
   */
  | { type: "ref"; name: string }
  | { type: "unknown" };

export type PropertyInfo = { schema: Schema; required: boolean };

/** The named schemas every `{ type: "ref" }` in a result resolves against. */
export type SchemaDefinitions = Record<string, Schema>;

// Path representation - parsed from Express-style paths
export type PathInfo = { raw: string; segments: PathSegment[] };
export type PathSegment =
  | { type: "static"; value: string }
  | { type: "param"; name: string };

// Response variants from the discriminated union on `result`
export type ResponseVariant = {
  result: string | null; // null if no `result` field (raw middleware response)
  statusCode: number | null; // null if not determinable
  properties: Record<string, PropertyInfo>; // other props (excluding result, statusCode, next)
};

// Main route info
export type RouteInfo = {
  name: string;
  description: string | undefined;
  /** `null` when the route has no `.path()`: it is only reachable through the RPC endpoint. */
  path: PathInfo | null;
  method: string;
  bodySchema: Schema | null;
  querySchema: Schema | null;
  paramsSchema: Schema | null;
  headersSchema: Schema | null;
  response: ResponseVariant[];
};

/** Routes plus the named definitions their `ref` nodes point at. */
export type InspectResult = {
  routes: RouteInfo[];
  definitions: SchemaDefinitions;
};
