import fs from "fs";
import { inspectRoutes } from "@cuple/inspect";
import type { RouteInfo, ResponseVariant } from "@cuple/inspect";
import {
  convertSchemaToOpenAPI,
  convertPropertiesToOpenAPI,
  type OpenAPISchemaObject,
} from "./schema-converter";

export type OpenAPIInfo = {
  title: string;
  version: string;
  description?: string;
};

export type OpenAPIParameter = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: OpenAPISchemaObject;
};

export type OpenAPIResponse = {
  description: string;
  content?: {
    "application/json": {
      schema: OpenAPISchemaObject;
    };
  };
};

export type OpenAPIOperation = {
  operationId?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content: {
      "application/json": {
        schema: OpenAPISchemaObject;
      };
    };
  };
  responses: Record<string, OpenAPIResponse>;
};

export type OpenAPIDocument = {
  openapi: string;
  info: OpenAPIInfo;
  paths: Record<string, Record<string, OpenAPIOperation>>;
};

export type GenerateOpenAPIOptions = {
  tsconfigPath?: string;
  info?: { title?: string; version?: string; description?: string };
  outputFile?: string;
};

function toOpenAPIPath(raw: string): string {
  return raw.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
}

function buildParameters(route: RouteInfo): OpenAPIParameter[] {
  const params: OpenAPIParameter[] = [];

  // Path params from segments
  for (const seg of route.path.segments) {
    if (seg.type === "param") {
      let schema: OpenAPISchemaObject = { type: "string" };
      // Try to get schema from paramsSchema
      if (
        route.paramsSchema &&
        route.paramsSchema.type === "object" &&
        route.paramsSchema.properties[seg.name]
      ) {
        schema = convertSchemaToOpenAPI(route.paramsSchema.properties[seg.name].schema);
      }
      params.push({
        name: seg.name,
        in: "path",
        required: true,
        schema,
      });
    }
  }

  // Query params
  if (route.querySchema && route.querySchema.type === "object") {
    for (const [name, info] of Object.entries(route.querySchema.properties)) {
      params.push({
        name,
        in: "query",
        required: info.required,
        schema: convertSchemaToOpenAPI(info.schema),
      });
    }
  }

  // Header params
  if (route.headersSchema && route.headersSchema.type === "object") {
    for (const [name, info] of Object.entries(route.headersSchema.properties)) {
      params.push({
        name,
        in: "header",
        required: info.required,
        schema: convertSchemaToOpenAPI(info.schema),
      });
    }
  }

  return params;
}

function buildResponseSchema(variant: ResponseVariant): OpenAPISchemaObject {
  const { properties, required } = convertPropertiesToOpenAPI(variant.properties);

  // Add the result field as a literal enum
  if (variant.result !== null) {
    properties["result"] = { type: "string", enum: [variant.result] };
    required.push("result");
  }

  const schema: OpenAPISchemaObject = { type: "object", properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function buildResponses(route: RouteInfo): Record<string, OpenAPIResponse> {
  const responses: Record<string, OpenAPIResponse> = {};

  // Group variants by status code
  const grouped = new Map<string, ResponseVariant[]>();
  for (const variant of route.response) {
    const key = variant.statusCode !== null ? String(variant.statusCode) : "default";
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(variant);
  }

  for (const [statusCode, variants] of grouped) {
    const description = variants.map((v) => v.result ?? "Response").join(" | ");

    let schema: OpenAPISchemaObject;
    if (variants.length === 1) {
      schema = buildResponseSchema(variants[0]);
    } else {
      schema = {
        oneOf: variants.map(buildResponseSchema),
      };
    }

    responses[statusCode] = {
      description,
      content: {
        "application/json": { schema },
      },
    };
  }

  return responses;
}

function buildOperation(route: RouteInfo): OpenAPIOperation {
  const operation: OpenAPIOperation = {
    responses: buildResponses(route),
  };

  if (route.name) {
    operation.operationId = route.name;
  }

  if (route.description) {
    operation.description = route.description;
  }

  const parameters = buildParameters(route);
  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (route.bodySchema) {
    operation.requestBody = {
      content: {
        "application/json": {
          schema: convertSchemaToOpenAPI(route.bodySchema),
        },
      },
    };
  }

  return operation;
}

export function generateOpenAPI(
  filePath: string,
  variableName: string,
  options?: GenerateOpenAPIOptions,
): OpenAPIDocument {
  const routes = inspectRoutes(filePath, variableName, {
    tsconfigPath: options?.tsconfigPath,
  });

  const doc: OpenAPIDocument = {
    openapi: "3.0.0",
    info: {
      title: options?.info?.title ?? "API",
      version: options?.info?.version ?? "1.0.0",
      ...(options?.info?.description ? { description: options.info.description } : {}),
    },
    paths: {},
  };

  for (const route of routes) {
    const path = toOpenAPIPath(route.path.raw);
    if (!doc.paths[path]) {
      doc.paths[path] = {};
    }
    doc.paths[path][route.method] = buildOperation(route);
  }

  if (options?.outputFile) {
    fs.writeFileSync(options.outputFile, JSON.stringify(doc, null, 2));
  }

  return doc;
}
