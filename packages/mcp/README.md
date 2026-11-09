# @cuple/mcp

Expose [Cuple](https://github.com/fxdave/cuple) routes as [MCP](https://modelcontextprotocol.io) tools.

## Installation

```bash
npm i -D @cuple/mcp typescript
```

## Usage

```ts
// mcp.ts
import { serveMcp } from "@cuple/mcp";

serveMcp("./src/routes.ts", "routes", { url: "http://localhost:8080/rpc" });
```

```bash
claude mcp add my-api -- npx tsx mcp.ts
```

Every route is a tool, with its `params`, `query`, `body` and `headers` as input. A route that needs `authorization` says so, so the agent logs in through your login route and sends the token.

## Over HTTP

A remote MCP server, e.g. for Claude connectors, serves tools generated at build time, so production needs no TypeScript sources:

```bash
cuple-mcp tools src/mcpRoutes.ts mcpRoutes > dist/mcp-tools.json
```

```ts
import { createMcpHttpHandler } from "@cuple/mcp";
import tools from "./mcp-tools.json";

app.post(
  "/mcp",
  express.json(),
  createMcpHttpHandler(tools, {
    url: "http://localhost:8080/rpc",
    // The client's token goes to every call; the agent never sees it.
    forwardHeaders: ["authorization"],
  }),
);
```

Please check the [docs](https://fxdave.github.io/cuple/)
