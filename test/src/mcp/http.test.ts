import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { createClient } from "@cuple/client";
import { createMcpServer, generateMcpTools, handleMcpRequest } from "@cuple/mcp";
import { createBuilder } from "@cuple/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { withoutInjected } from "../../../packages/mcp/src/tools";
import { app, type routes } from "./routes.fixture";

const routesFile = path.resolve(__dirname, "routes.fixture.ts");
const tsconfigPath = path.resolve(__dirname, "../../tsconfig.json");

let rpc: HttpServer;
let mcpHttp: HttpServer;
let mcpUrl: URL;

beforeAll(async () => {
  rpc = app.listen(0);
  await new Promise((resolve) => rpc.once("listening", resolve));
  const api = createClient<typeof routes>({
    path: `http://localhost:${(rpc.address() as { port: number }).port}/rpc`,
  });
  // As a build step writes them.
  const tools = JSON.parse(
    JSON.stringify(generateMcpTools(routesFile, "routes", { tsconfigPath })),
  );

  // The MCP endpoint is an ordinary route: its own auth, its own client.
  const mcpApp = express();
  const builder = createBuilder(mcpApp);
  const apiKey = builder
    .headersSchema(z.looseObject({ "x-api-key": z.string() }))
    .middleware(async ({ data }) =>
      data.headers["x-api-key"] === "k-1"
        ? { next: true as const, token: "t-123" }
        : { next: false as const, statusCode: 401, message: "Bad key" },
    )
    .buildLink();
  builder
    .path("/mcp")
    .chain(apiKey)
    .postRaw(async ({ req, res, data }) => {
      if (!data.next) {
        res.status(data.statusCode).json(data);
        return;
      }
      const client = api.with({
        middleware: () => ({ headers: { authorization: `Bearer ${data.token}` } }),
      });
      await handleMcpRequest(createMcpServer(tools, client), req, res);
    });

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

async function connect(headers: Record<string, string> = { "x-api-key": "k-1" }) {
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers } }),
  );
  return mcp;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

describe("MCP over HTTP, from a cuple route", { timeout: 30_000 }, () => {
  it("runs the route's own auth first", async () => {
    await expect(connect({ "x-api-key": "wrong" })).rejects.toThrow();
  });

  it("hides what the client injects from the tools", async () => {
    const { tools } = await (await connect()).listTools();
    const createPost = tools.find((tool) => tool.name === "createPost")!;
    expect(Object.keys(createPost.inputSchema.properties!)).toEqual(["title"]);
    expect(createPost.inputSchema.required).toEqual(["title"]);
  });

  it("calls the routes with what the client injects", async () => {
    const created = await (await connect()).callTool({
      name: "createPost",
      arguments: { title: "Hi" },
    });
    expect(created.isError).toBe(false);
    expect(text(created)).toMatchObject({ result: "success", title: "Hi" });
  });

  it("an agent can't override what the client injects", async () => {
    const result = await (await connect()).callTool({
      name: "createPost",
      arguments: { title: "Hi", authorization: "Bearer wrong", headers: "x" },
    });
    expect(text(result)).toMatchObject({ result: "success" });
  });
});

describe("withoutInjected", () => {
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

  it("keeps the keys the agent still sends", () => {
    expect(
      withoutInjected(tool, { headers: { authorization: "x" } }).inputSchema,
    ).toEqual({
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

  it("drops a part when nothing is left of it, or it is injected whole", () => {
    const both = { headers: { authorization: "x", "x-org": "y" } };
    expect(withoutInjected(tool, both).inputSchema).toEqual({
      type: "object",
      properties: { body: { type: "object" } },
      required: ["body"],
    });
    expect(
      withoutInjected(tool, { body: "raw" }).inputSchema.properties,
    ).not.toHaveProperty("body");
  });
});

describe("createMcpServer's client", () => {
  it("takes a client with or without .with()", () => {
    const api = createClient<typeof routes>({ path: "http://localhost/rpc" });
    const authed = api.with({ middleware: () => ({ headers: { authorization: "x" } }) });
    expect(createMcpServer([], api)).toBeDefined();
    expect(createMcpServer([], authed)).toBeDefined();
  });
});
