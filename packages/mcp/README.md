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

Please check the [docs](https://fxdave.github.io/cuple/)
