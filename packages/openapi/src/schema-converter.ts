import type { Schema, PropertyInfo } from "@cuple/inspect";

export type OpenAPISchemaObject = {
  type?: string;
  enum?: (string | number | boolean)[];
  items?: OpenAPISchemaObject;
  properties?: Record<string, OpenAPISchemaObject>;
  required?: string[];
  oneOf?: OpenAPISchemaObject[];
};

export function convertSchemaToOpenAPI(schema: Schema): OpenAPISchemaObject {
  switch (schema.type) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "unknown":
      return {};
    case "literal": {
      const t =
        typeof schema.value === "string"
          ? "string"
          : typeof schema.value === "number"
            ? "number"
            : "boolean";
      return { type: t, enum: [schema.value] };
    }
    case "array":
      return { type: "array", items: convertSchemaToOpenAPI(schema.items) };
    case "union":
      return { oneOf: schema.variants.map(convertSchemaToOpenAPI) };
    case "object": {
      const { properties, required } = convertPropertiesToOpenAPI(schema.properties);
      const result: OpenAPISchemaObject = { type: "object", properties };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }
  }
}

export function convertPropertiesToOpenAPI(props: Record<string, PropertyInfo>): {
  properties: Record<string, OpenAPISchemaObject>;
  required: string[];
} {
  const properties: Record<string, OpenAPISchemaObject> = {};
  const required: string[] = [];

  for (const [key, info] of Object.entries(props)) {
    properties[key] = convertSchemaToOpenAPI(info.schema);
    if (info.required) {
      required.push(key);
    }
  }

  return { properties, required };
}
