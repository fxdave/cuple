// Schema representation - discriminated union
export type Schema =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "literal"; value: string | number | boolean }
  | { type: "array"; items: Schema }
  | { type: "object"; properties: Record<string, PropertyInfo> }
  | { type: "union"; variants: Schema[] }
  | { type: "unknown" };

export type PropertyInfo = { schema: Schema; required: boolean };

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
  path: PathInfo;
  method: string;
  bodySchema: Schema | null;
  querySchema: Schema | null;
  paramsSchema: Schema | null;
  headersSchema: Schema | null;
  response: ResponseVariant[];
};
