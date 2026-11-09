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

For a remote MCP server, such as a connector users add to their AI app. Write the tools at build time, so production needs no TypeScript sources:

```bash
cuple-mcp tools src/routes.ts routes > src/mcp-tools.json
```

```ts
import { createMcpHttpHandler } from "@cuple/mcp";
import tools from "./mcp-tools.json";

app.all(
  "/mcp",
  createMcpHttpHandler(tools, {
    url: "http://localhost:8080/rpc",
    // The user's token goes to every call; the agent never sees it.
    forwardHeaders: ["authorization"],
  }),
);
```

Please check the [docs](https://fxdave.github.io/cuple/)
