import type { Server as HttpServer } from "node:http";
import path from "node:path";
import type { RouteInfo } from "@cuple/inspect";
import { createMcpServer, type McpOptions, routeToTool } from "@cuple/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./routes.fixture";

const routesFile = path.resolve(__dirname, "routes.fixture.ts");
const tsconfigPath = path.resolve(__dirname, "../../tsconfig.json");

let http: HttpServer;
let url: string;

beforeAll(async () => {
  http = app.listen(0);
  await new Promise((resolve) => http.once("listening", resolve));
  url = `http://localhost:${(http.address() as { port: number }).port}/rpc`;
});
afterAll(() => http.close());

async function connect(options: Partial<McpOptions> = {}) {
  const server = createMcpServer(routesFile, "routes", { url, tsconfigPath, ...options });
  const mcp = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

// Each connect builds a TypeScript program for the routes: seconds, more under
// the full suite's load.
describe("MCP", { timeout: 30_000 }, () => {
  it("lists a tool per route, with only the inputs the route takes", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "auth.login",
      "createPost",
      "posts.getPost",
      "posts.search",
    ]);
    const getPost = tools.find((tool) => tool.name === "posts.getPost")!;
    expect(getPost.description).toBe("Gets one post");
    expect(getPost.inputSchema.required).toEqual(["params"]);
    // Every query field is optional, so the query is too.
    const search = tools.find((tool) => tool.name === "posts.search")!;
    expect(search.inputSchema.required).toEqual([]);
    // A route's headers are input like any other part, so the agent sees what it needs.
    const createPost = tools.find((tool) => tool.name === "createPost")!;
    expect(Object.keys(createPost.inputSchema.properties!).sort()).toEqual([
      "body",
      "headers",
    ]);
    expect(createPost.inputSchema.required).toContain("headers");
    expect(createPost.inputSchema.properties!.headers).toMatchObject({
      properties: { authorization: { type: "string" } },
      required: ["authorization"],
    });
    expect(Object.keys(getPost.inputSchema.properties!)).toEqual(["params"]);
  });

  it("calls routes through the RPC endpoint, including ones without a path", async () => {
    const mcp = await connect();

    const found = await mcp.callTool({
      name: "posts.getPost",
      arguments: { params: { id: 1 } },
    });
    expect(found.isError).toBe(false);
    expect(text(found)).toMatchObject({ result: "success", title: "Hello" });

    const search = await mcp.callTool({
      name: "posts.search",
      arguments: { query: { q: "x" } },
    });
    expect(text(search)).toMatchObject({ result: "success", q: "x" });
  });

  it("marks non-success results as errors", async () => {
    const mcp = await connect();
    const missing = await mcp.callTool({
      name: "posts.getPost",
      arguments: { params: { id: 2 } },
    });

    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatchObject({ result: "not-found", statusCode: 404 });
  });

  it("an agent can log in, and send the token to a gated route", async () => {
    const mcp = await connect();
    const createPost = (headers?: object) =>
      mcp.callTool({ name: "createPost", arguments: { body: { title: "Hi" }, headers } });

    expect((await createPost()).isError).toBe(true);

    const login = await mcp.callTool({
      name: "auth.login",
      arguments: { body: { password: "hunter2" } },
    });
    const { token } = text(login);

    const created = await createPost({ authorization: `Bearer ${token}` });
    expect(text(created)).toMatchObject({ result: "success", title: "Hi" });
  });

  it("reports network failures as tool errors", async () => {
    const mcp = await connect({ url: "http://localhost:1/rpc" });
    const result = await mcp.callTool({ name: "posts.search", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/fetch failed/);
  });

  it("rejects unknown tools", async () => {
    const mcp = await connect();
    await expect(mcp.callTool({ name: "nope", arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    );
  });

  // A ref points into an OpenAPI document's `components.schemas`, which a tool
  // schema has no equivalent of, and clients rewrite tool schemas for their
  // provider — so a recursive input says nothing rather than carrying a pointer
  // the client may drop.
  it("leaves a recursive input unconstrained instead of emitting a $ref", () => {
    const route: RouteInfo = {
      name: "saveTree",
      description: undefined,
      path: null,
      method: "post",
      bodySchema: {
        type: "object",
        properties: {
          root: { schema: { type: "ref", name: "TreeNode" }, required: true },
          tags: {
            schema: { type: "array", items: { type: "ref", name: "Tag" } },
            required: false,
          },
        },
      },
      querySchema: null,
      paramsSchema: null,
      headersSchema: null,
      response: [],
    };

    const tool = routeToTool(route);
    expect(tool.inputSchema.properties!.body).toEqual({
      type: "object",
      properties: { root: {}, tags: { type: "array", items: {} } },
      required: ["root"],
    });
    expect(JSON.stringify(tool)).not.toContain("$ref");
  });
});
