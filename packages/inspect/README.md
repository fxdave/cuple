# @cuple/inspect

Extract structured metadata from [Cuple](https://github.com/fxdave/cuple) route definitions at build time using the TypeScript compiler API.

## Install

```bash
npm install @cuple/inspect
```

Peer dependencies: `typescript ^5.0.0`, `@cuple/server`

## Usage

```typescript
import { inspectRoutes } from "@cuple/inspect";

const routes = inspectRoutes("./src/routes.ts", "routes", {
  tsconfigPath: "./tsconfig.json",
});

for (const route of routes) {
  console.log(`${route.method.toUpperCase()} ${route.path.raw}`);
  // GET /health
  // POST /api/posts
  // GET /api/posts/:postId/comments/:commentId
}
```

## What it extracts

Given a Cuple route file like:

```typescript
const createPost = builder
  .meta({ name: "Create Post", description: "Creates a new blog post" })
  .path("/api/posts")
  .bodySchema(z.object({ title: z.string(), content: z.string() }))
  .post(async ({ data }) => {
    return success({ id: "post-1" });
  });

export const routes = { createPost };
```

`inspectRoutes` returns a `RouteInfo[]` with:

- **name** — property key or meta name (`"createPost"`)
- **description** — from `.meta()` (`"Creates a new blog post"`)
- **path** — raw string + parsed segments with param detection
- **method** — HTTP method (`"post"`)
- **bodySchema / querySchema / paramsSchema / headersSchema** — structured `Schema` objects
- **response** — variants with `result`, `statusCode`, and property schemas

## API

### `inspectRoutes(filePath, variableName, options?)`

| Param | Type | Description |
|---|---|---|
| `filePath` | `string` | Path to the source file containing the routes |
| `variableName` | `string` | Name of the exported variable holding the routes object |
| `options.tsconfigPath` | `string?` | Path to tsconfig.json (auto-detected if omitted) |

Returns `RouteInfo[]`.

### `inspectRoutesFromProgram(program, sourceFile, variableName)`

Lower-level API that accepts an existing `ts.Program` and `ts.SourceFile` directly, useful when you already have a TypeScript program instance.

## License

MIT
