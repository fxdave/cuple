import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { createClient } from "@cuple/client";
import { inspectRoutes } from "@cuple/inspect";
import { createCupleMcpServer } from "@cuple/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, type routes } from "./routes.fixture";

const routeInfos = inspectRoutes(path.resolve(__dirname, "routes.fixture.ts"), "routes", {
  tsconfigPath: path.resolve(__dirname, "../../tsconfig.json"),
});

let http: HttpServer;
let url: string;

beforeAll(async () => {
  http = app.listen(0);
  await new Promise((resolve) => http.once("listening", resolve));
  url = `http://localhost:${(http.address() as { port: number }).port}/rpc`;
});
afterAll(() => http.close());

async function connect(client: object) {
  const server = createCupleMcpServer({ routes: routeInfos, client });
  const mcp = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

describe("MCP", () => {
  it("lists a tool per route, with only the inputs the route takes", async () => {
    const mcp = await connect(createClient<typeof routes>({ path: url }));
    const { tools } = await mcp.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
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
    // Headers are the client's job, never the model's.
    const createPost = tools.find((tool) => tool.name === "createPost")!;
    expect(Object.keys(createPost.inputSchema.properties!)).toEqual(["body"]);
  });

  it("calls routes through the RPC endpoint, including ones without a path", async () => {
    const mcp = await connect(createClient<typeof routes>({ path: url }));

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
    const mcp = await connect(createClient<typeof routes>({ path: url }));
    const missing = await mcp.callTool({
      name: "posts.getPost",
      arguments: { params: { id: 2 } },
    });

    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatchObject({ result: "not-found", statusCode: 404 });
  });

  it("sends headers from the client's middleware", async () => {
    const client = createClient<typeof routes>({ path: url });
    const call = { name: "createPost", arguments: { body: { title: "Hi" } } };

    const anonymous = await (await connect(client)).callTool(call);
    expect(anonymous.isError).toBe(true);

    const authed = client.with({
      middleware: () => ({ headers: { authorization: "secret" } }),
    });
    const created = await (await connect(authed)).callTool(call);
    expect(text(created)).toMatchObject({ result: "success", title: "Hi" });
  });

  it("reports network failures as tool errors", async () => {
    const mcp = await connect(
      createClient<typeof routes>({ path: "http://localhost:1/rpc" }),
    );
    const result = await mcp.callTool({ name: "posts.search", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/fetch failed/);
  });

  it("rejects unknown tools", async () => {
    const mcp = await connect(createClient<typeof routes>({ path: url }));
    await expect(mcp.callTool({ name: "nope", arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    );
  });
});
