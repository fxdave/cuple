# @cuple/openapi

Generate [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.0) specifications from [Cuple](https://github.com/fxdave/cuple) route definitions. Uses `@cuple/inspect` under the hood.

## Install

```bash
npm install @cuple/openapi
```

Peer dependencies: `typescript ^5.0.0`

## Example

Given a `src/routes.ts`:

```typescript
import express from "express";
import z from "zod";
import { createBuilder, apiResponse, success } from "@cuple/server";

const app = express();
const builder = createBuilder(app);

const getHealth = builder.path("/health").get(async () => {
  return success({ status: "ok" });
});

const createPost = builder
  .meta({ name: "Create Post", description: "Creates a new blog post" })
  .path("/api/posts")
  .bodySchema(z.object({ title: z.string(), content: z.string() }))
  .post(async ({ data }) => {
    return success({ id: "post-1" });
  });

const getPost = builder
  .path("/api/posts/:id")
  .paramsSchema(z.object({ id: z.string() }))
  .get(async ({ data }) => {
    if (!data.id) {
      return apiResponse("not-found", 404, { message: "Post not found" });
    }
    return success({ title: "Hello", content: "World" });
  });

export const routes = { getHealth, createPost, getPost };
```

Generate the spec:

```typescript
import { generateOpenAPI } from "@cuple/openapi";

const doc = generateOpenAPI("./src/routes.ts", "routes", {
  tsconfigPath: "./tsconfig.json",
  info: {
    title: "My API",
    version: "2.0.0",
    description: "Blog API",
  },
  outputFile: "./openapi.json", // optional: write to disk
});

console.log(JSON.stringify(doc, null, 2));
```

Output:

```json
{
  "openapi": "3.0.0",
  "info": { "title": "My API", "version": "2.0.0", "description": "Blog API" },
  "paths": {
    "/api/posts": {
      "post": {
        "operationId": "createPost",
        "description": "Creates a new blog post",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": { "type": "string" },
                  "content": { "type": "string" }
                },
                "required": ["title", "content"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": { "type": "string" },
                    "result": { "type": "string", "enum": ["success"] }
                  },
                  "required": ["id", "result"]
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## API

### `generateOpenAPI(filePath, variableName, options?)`

| Param | Type | Description |
|---|---|---|
| `filePath` | `string` | Path to the source file containing the routes |
| `variableName` | `string` | Name of the exported variable holding the routes object |
| `options.tsconfigPath` | `string?` | Path to tsconfig.json |
| `options.info` | `{ title?, version?, description? }?` | OpenAPI info block (defaults: `"API"`, `"1.0.0"`) |
| `options.outputFile` | `string?` | If set, writes the JSON document to this path |

Returns an `OpenAPIDocument`.

### How routes map to OpenAPI

| Cuple | OpenAPI |
|---|---|
| `.path("/posts/:id")` | Path `/posts/{id}` with path parameter |
| `.get()` / `.post()` / ... | Operation under the corresponding HTTP method |
| `.bodySchema(z.object({...}))` | `requestBody` with `application/json` content |
| `.querySchema(z.object({...}))` | `parameters` with `in: "query"` |
| `.headersSchema(z.object({...}))` | `parameters` with `in: "header"` |
| `.paramsSchema(z.object({...}))` | Path parameter schemas |
| `success({...})` / `apiResponse(...)` | `responses` grouped by status code |
| `.meta({ name, description })` | `operationId` and `description` |

## License

MIT
