import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { createMcpHttpHandler, generateMcpTools } from "@cuple/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withoutHeaders } from "../../../packages/mcp/src/tools";
import { app } from "./routes.fixture";

const routesFile = path.resolve(__dirname, "routes.fixture.ts");
const tsconfigPath = path.resolve(__dirname, "../../tsconfig.json");

let rpc: HttpServer;
let mcpHttp: HttpServer;
let mcpUrl: URL;
let rpcUrl: string;

beforeAll(async () => {
  rpc = app.listen(0);
  await new Promise((resolve) => rpc.once("listening", resolve));
  rpcUrl = `http://localhost:${(rpc.address() as { port: number }).port}/rpc`;
  const url = rpcUrl;

  // Through JSON, as a build step would write it.
  const tools = JSON.parse(
    JSON.stringify(generateMcpTools(routesFile, "routes", { tsconfigPath })),
  );
  // No body parser: the handler reads the request itself.
  const mcpApp = express();
  mcpApp.all(
    "/mcp",
    createMcpHttpHandler(tools, { url, forwardHeaders: ["Authorization"] }),
  );
  mcpHttp = mcpApp.listen(0);
  await new Promise((resolve) => mcpHttp.once("listening", resolve));
  mcpUrl = new URL(
    `http://localhost:${(mcpHttp.address() as { port: number }).port}/mcp`,
  );
});
afterAll(() => {
  rpc.close();
  mcpHttp.close();
});

async function connect(headers: Record<string, string> = {}) {
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }),
  );
  return mcp;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

describe("MCP over HTTP", { timeout: 30_000 }, () => {
  it("hides forwarded headers from the tools", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    const createPost = tools.find((tool) => tool.name === "createPost")!;

    expect(Object.keys(createPost.inputSchema.properties!)).toEqual(["body"]);
    expect(createPost.inputSchema.required).toEqual(["body"]);
  });

  it("passes the client's header to the route", async () => {
    const call = (mcp: Client) =>
      mcp.callTool({ name: "createPost", arguments: { body: { title: "Hi" } } });

    expect((await call(await connect())).isError).toBe(true);
    expect((await call(await connect({ authorization: "Bearer wrong" }))).isError).toBe(
      true,
    );

    const created = await call(await connect({ authorization: "Bearer t-123" }));
    expect(created.isError).toBe(false);
    expect(text(created)).toMatchObject({ result: "success", title: "Hi" });
  });

  it("answers only POST", async () => {
    const res = await fetch(mcpUrl);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("works behind a body parser too", async () => {
    const parsed = express();
    parsed.use(express.json());
    parsed.post(
      "/mcp",
      createMcpHttpHandler(generateMcpTools(routesFile, "routes", { tsconfigPath }), {
        url: rpcUrl,
      }),
    );
    const server = parsed.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const mcp = new Client({ name: "test", version: "1.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)),
    );
    const { tools } = await mcp.listTools();
    server.close();
    expect(tools.map((tool) => tool.name)).toContain("posts.getPost");
  });

  it("an agent-supplied header does not override a forwarded one", async () => {
    const mcp = await connect({ authorization: "Bearer wrong" });
    const result = await mcp.callTool({
      name: "createPost",
      arguments: { body: { title: "Hi" }, headers: { authorization: "Bearer t-123" } },
    });
    expect(result.isError).toBe(true);
  });
});

describe("withoutHeaders", () => {
  const tool = {
    name: "t",
    inputSchema: {
      type: "object" as const,
      properties: {
        body: { type: "object" },
        headers: {
          type: "object",
          properties: { authorization: { type: "string" }, "x-org": { type: "string" } },
          required: ["authorization", "x-org"],
        },
      },
      required: ["body", "headers"],
    },
  };

  it("keeps the headers the agent still sends", () => {
    expect(withoutHeaders(tool, ["authorization"]).inputSchema).toEqual({
      type: "object",
      properties: {
        body: { type: "object" },
        headers: {
          type: "object",
          properties: { "x-org": { type: "string" } },
          required: ["x-org"],
        },
      },
      required: ["body", "headers"],
    });
  });

  it("drops headers when none are left", () => {
    expect(withoutHeaders(tool, ["authorization", "x-org"]).inputSchema).toEqual({
      type: "object",
      properties: { body: { type: "object" } },
      required: ["body"],
    });
  });
});
