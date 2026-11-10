# @cuple/mcp

Expose [Cuple](https://github.com/fxdave/cuple) routes as [MCP](https://modelcontextprotocol.io) tools. It's a client: tool calls go to your API through a `@cuple/client`, with whatever that client sends.

## Installation

```bash
npm i @cuple/mcp && npm i -D typescript
```

## Usage

Write the tools from your route types, at build time:

```bash
cuple-mcp tools src/routes.ts routes > src/mcp-tools.ts
```

Serve them to a local agent over stdio:

```ts
// mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
import { serveMcp } from "@cuple/mcp";
import { tools } from "./mcp-tools";

const api = createClient<typeof routes>({ path: "http://localhost:8080/rpc" });
serveMcp(tools, api.with({
  middleware: () => ({ headers: { authorization: `Bearer ${process.env.TOKEN}` } }),
}));
```

Or remotely, from a route of your own, so the request's own auth decides what the tools send:

```ts
import { createMcpServer, handleMcpRequest } from "@cuple/mcp";

mcp: builder
  .path("/mcp")
  .chain(authLink)
  .postRaw(async ({ req, res, data }) => {
    if (!data.next) return void res.status(401).set("WWW-Authenticate", "Bearer").json(data);
    const client = api.with({ middleware: () => ({ headers: { authorization: req.headers.authorization } }) });
    await handleMcpRequest(createMcpServer(tools, client), req, res);
  }),
```

What the client's `with({ middleware })` injects is sent with every call and hidden from the agent's tools. Tools are named `posts_getPost`, take their inputs flat (`{ id, title }`), and are marked read-only for GET routes.

Please check the [docs](https://fxdave.github.io/cuple/)
