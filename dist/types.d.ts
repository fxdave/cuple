export type Schema = {
    type: "string";
} | {
    type: "number";
} | {
    type: "boolean";
} | {
    type: "literal";
    value: string | number | boolean;
} | {
    type: "array";
    items: Schema;
} | {
    type: "object";
    properties: Record<string, PropertyInfo>;
} | {
    type: "union";
    variants: Schema[];
}
/**
 * A named definition, held in {@link InspectResult.definitions}. Emitted
 * where the walk closes a cycle, so a recursive type is described once and
 * pointed at instead of being cut off.
 */
 | {
    type: "ref";
    name: string;
} | {
    type: "unknown";
};
export type PropertyInfo = {
    schema: Schema;
    required: boolean;
};
/** The named schemas every `{ type: "ref" }` in a result resolves against. */
export type SchemaDefinitions = Record<string, Schema>;
export type PathInfo = {
    raw: string;
    segments: PathSegment[];
};
export type PathSegment = {
    type: "static";
    value: string;
} | {
    type: "param";
    name: string;
};
export type ResponseVariant = {
    result: string | null;
    statusCode: number | null;
    properties: Record<string, PropertyInfo>;
};
export type RouteInfo = {
    name: string;
    description: string | undefined;
    /** The route's `.meta({ … })` fields that have literal values, e.g. `{ readOnly: true }`. */
    meta: Record<string, string | number | boolean>;
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
