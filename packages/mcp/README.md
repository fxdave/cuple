# @cuple/mcp

Serve [Cuple](https://github.com/fxdave/cuple) routes as [MCP](https://modelcontextprotocol.io) tools, so AI agents can call them.

## Installation

```bash
npm i @cuple/mcp
```

## Usage

An MCP endpoint in your own server, behind an auth link of its own:

```ts
import { createMcpEndpoint } from "@cuple/mcp";

export const mcp = createMcpEndpoint(builder.path("/mcp").chain(mcpAuthLink), {
  // Tools of its own: they see what mcpAuthLink gave.
  tools: (b) => ({
    whoAmI: b.meta({ description: "Says who is signed in" }).get(async ({ data }) => success({ user: data.user })),
  }),
  // Routes made for your app, offered too: exactly these, with the credentials they take.
  routes: {
    pick: { getPost: routes.posts.getPost },
    inject: async ({ data }) => ({ headers: { authorization: `Bearer ${await tokenFor(data.user)}` } }),
  },
});
```

Tools come from the routes' zod schemas and `.meta({ description })`, and run in-process. What `inject` returns is hidden from the agent and wins over what it sends.

For a local agent over stdio, a separate process calls your API through a client:

```ts
// mcp.ts, then: claude mcp add my-api -- npx tsx mcp.ts
serveMcp(routes, createClient<typeof routes>({ path: "http://localhost:8080/rpc" }).with({
  middleware: () => ({ headers: { authorization: `Bearer ${process.env.TOKEN}` } }),
}));
```

Please check the [docs](https://fxdave.github.io/cuple/docs/server/mcp)
