<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="artwork/cuple_compact_dark_export.svg">
    <img alt="Cuple" src="artwork/cuple_compact_light_export.svg" width="96">
  </picture>
</p>

<h1 align="center">Cuple RPC</h1>

<p align="center">
  <b>End-to-end type safety for TypeScript, without giving up REST.</b><br>
  Define a route on the server, call it from the client. Params, query, headers, body<br>
  and every error response are typed.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cuple/server"><img alt="npm" src="https://img.shields.io/npm/v/@cuple/server?color=6b3fa0"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-6b3fa0">
  <a href="https://fxdave.github.io/cuple/"><img alt="docs" src="https://img.shields.io/badge/docs-fxdave.github.io%2Fcuple-6b3fa0"></a>
</p>

<p align="center">
  <a href="https://fxdave.github.io/cuple/">Docs</a> ·
  <a href="https://stackblitz.com/~/github.com/fxdave/react-express-cuple-boilerplate/tree/stackblitz?file=backend/src/index.ts">Try it on StackBlitz</a> ·
  <a href="https://github.com/fxdave/react-express-cuple-boilerplate">Boilerplate</a>
</p>

## Why Cuple

- **Errors are part of the type.** Every response the handler can return (`success`, `post-not-found`, `invalid-body`, ...) is a discriminated union on the client. You handle failures the compiler knows about, not `catch (e: unknown)`. Return them with `notFound`, `unauthorized`, `forbidden` and `conflict`, and name each one when the client needs to tell them apart.
- **No lock-in.** Give a route a `.path()` and it's also a regular REST endpoint, documented by an OpenAPI spec generated from the same definition. Other teams and third parties can use your API without Cuple.
- **The whole request is typed.** URL params, query strings and headers are validated and typed, not just the body.
- **Just Express.** Cuple routes sit next to your existing ones. Logging, CORS, sessions and middlewares keep working.
- **Batteries included.** React 19 bindings with Suspense and a cache, OpenAPI 3.0 generation, and MCP tools for AI agents, all from the same route definitions. More are on the way.

## Quick look

```bash
npm i @cuple/server @cuple/client express zod
```

**Server**

```ts
const builder = createBuilder(app);

export const routes = {
  getPost: builder
    .path("/post/:id") // optional, for REST clients
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .get(async ({ data }) => {
      const post = await findPost(data.params.id);
      if (!post) return notFound({ result: "post-not-found", message: "No such post" });
      return success({ post });
    }),
};

initRpc(app, { path: "/rpc", routes });
```

**Client**

```ts
const client = createClient<typeof routes>({ path: "http://localhost:8080/rpc" });

// Resolves with success; any other result throws.
const { post } = await fetchCuple(client.getPost.get, { params: { id: 1 } });

// Handle a failure by listing it. The result is typed: success | post-not-found.
const res = await fetchCuple(client.getPost.get, { params: { id: 1 } })
  .thenResolveAlso(["post-not-found"]);
if (res.result === "post-not-found") console.log(res.message);
```

**React**

```tsx
function Post({ id }: { id: number }) {
  const { post } = useGet(client.getPost, { params: { id } }); // suspends until loaded
  return <h1>{post.title}</h1>;
}
```

Rename a field on the server and the client stops compiling. Add a new error result and TypeScript shows you every place that should handle it.

## Packages

| Package | |
| ------- | - |
| [`@cuple/server`](./packages/server) | Express integration: routes, validation, middlewares, SSE |
| [`@cuple/client`](./packages/client) | Type-safe client: `fetchCuple`, `fetchCupleSSE` |
| [`@cuple/react`](./packages/react) | React 19 bindings: Suspense reads, actions, pagination, a cache |
| [`@cuple/openapi`](./packages/openapi) | Generate OpenAPI 3.0 specs from your routes |
| [`@cuple/mcp`](./packages/mcp) | Expose your routes as MCP tools |
| [`@cuple/inspect`](./packages/inspect) | Route metadata at build time (used by openapi and mcp) |

## Get started

- [Documentation](https://fxdave.github.io/cuple/)
- [Boilerplate](https://github.com/fxdave/react-express-cuple-boilerplate) (React + Express), or [open it in StackBlitz](https://stackblitz.com/~/github.com/fxdave/react-express-cuple-boilerplate/tree/stackblitz?file=backend/src/index.ts)
- Examples: [`test/src/examples`](./test/src/examples), tests: [`test/src`](./test/src)

## Used by

[![RolloutIt](https://github.com/fxdave/cuple/assets/12275699/72f9ce50-ffe1-46a2-b317-183dfe0467d0)](https://rolloutit.net/)

Open source:

- [PhotoBin](https://github.com/Linkee12/PhotoBin): temporary photo albums with end-to-end encryption
- [DavidHomeVentory](https://github.com/fxdave/DavidHomeVentory): household inventory with QR-tagged boxes and an Android client

## License

MIT
