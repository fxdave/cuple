import type { Server as HttpServer } from "node:http";
import { createClient } from "@cuple/client";
import { createMcpEndpoint, createMcpServer } from "@cuple/mcp";
import { createBuilder, initRpc, success } from "@cuple/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withoutInjected } from "../../../packages/mcp/src/tools";
import type { routes } from "./routes.fixture";

// An app whose routes take a token, and an MCP endpoint that takes an API key.
const app = express();
const builder = createBuilder(app);

const appAuth = builder
  .headersSchema(z.looseObject({ authorization: z.string() }))
  .middleware(async ({ data }) =>
    data.headers.authorization === "Bearer t-123"
      ? { next: true as const, user: "ann" }
      : { next: false as const, statusCode: 403, result: "forbidden" as const },
  )
  .buildLink();

const appRoutes = {
  posts: {
    create: builder
      .meta({ description: "Creates a post" })
      .chain(appAuth)
      .bodySchema(z.object({ title: z.string(), status: z.enum(["draft", "live"]) }))
      .post(async ({ data }) => success({ title: data.body.title, by: data.user })),
    remove: builder
      .meta({ description: "Deletes a post" })
      .chain(appAuth)
      .paramsSchema(z.object({ id: z.coerce.number() }))
      .delete(async ({ data }) => success({ removed: data.params.id })),
  },
  datasets: {
    list: builder
      .meta({ description: "Lists datasets" })
      .get(async () => success({ datasets: ["a"] })),
    count: builder
      .meta({ description: "Counts datasets", readOnly: true })
      .bodySchema(z.object({ city: z.string().optional() }))
      .post(async ({ data }) => success({ count: data.body.city ? 1 : 2 })),
  },
};
initRpc(app, { path: "/rpc", routes: appRoutes });

const apiKey = builder
  .headersSchema(z.looseObject({ "x-api-key": z.string() }))
  .middleware(async ({ data }) =>
    data.headers["x-api-key"].startsWith("k-")
      ? { next: true as const, account: data.headers["x-api-key"].slice(2) }
      : { next: false as const, statusCode: 401, message: "Bad key" },
  )
  .buildLink();

const injected = vi.fn();
const ownCalls = vi.fn();

export const mcp = createMcpEndpoint(builder.path("/mcp").chain(apiKey), {
  name: "test-api",
  tools: (b) => ({
    whoAmI: b
      .meta({ description: "Says which account is calling", readOnly: true })
      .querySchema(z.object({ shout: z.enum(["yes", "no"]).optional() }))
      .get(async ({ data }) => {
        ownCalls();
        const account =
          data.query.shout === "yes" ? data.account.toUpperCase() : data.account;
        return success({ account });
      }),
  }),
  routes: {
    pick: { posts: appRoutes.posts, datasets: appRoutes.datasets },
    inject: async ({ data }) => {
      injected(data.account);
      return {
        headers: { authorization: data.account === "ann" ? "Bearer t-123" : "Bearer no" },
      };
    },
  },
  toolListMiddleware: async ({ data, tools }) =>
    data.account === "ann"
      ? tools
      : tools
          .filter((tool) => !tool.name.startsWith("datasets"))
          .map((tool) =>
            tool.name === "posts_remove"
              ? { ...tool, description: `${tool.description}. Needs the Pro plan.` }
              : tool,
          ),
});

let http: HttpServer;
let mcpUrl: URL;

beforeAll(async () => {
  http = app.listen(0);
  await new Promise((resolve) => http.once("listening", resolve));
  mcpUrl = new URL(`http://localhost:${(http.address() as { port: number }).port}/mcp`);
});
afterAll(() => http.close());

async function connect(key = "k-ann") {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: { headers: { "x-api-key": key } },
    }),
  );
  return client;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text);

describe("createMcpEndpoint", () => {
  it("answers a failed chain with its response, and a 401 with WWW-Authenticate", async () => {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ message: "Bad key" });
    await expect(connect("wrong")).rejects.toThrow();
  });

  it("is stateless: GET and DELETE are 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(mcpUrl, { method, headers: { "x-api-key": "k-ann" } });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("lists its own tools and the picked routes, without what the server sends", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "datasets_count",
      "datasets_list",
      "posts_create",
      "posts_remove",
      "whoAmI",
    ]);
    const whoAmI = tools.find((tool) => tool.name === "whoAmI")!;
    // The endpoint's chain ran already: its x-api-key isn't the tool's input.
    expect(whoAmI.inputSchema).toEqual({
      type: "object",
      properties: { shout: { type: "string", enum: ["yes", "no"] } },
      required: [],
    });
    expect(whoAmI.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    const create = tools.find((tool) => tool.name === "posts_create")!;
    expect(create.inputSchema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: ["draft", "live"] },
      },
      required: ["title", "status"],
    });
    const remove = tools.find((tool) => tool.name === "posts_remove")!;
    expect(remove.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it("lets toolListMiddleware filter and refine the tools per caller", async () => {
    const bob = await connect("k-bob");
    const { tools } = await bob.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("datasets_list");
    expect(tools.find((tool) => tool.name === "posts_remove")!.description).toBe(
      "Deletes a post. Needs the Pro plan.",
    );
    // What it drops can't be called either.
    await expect(bob.callTool({ name: "datasets_list", arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("runs its own tools in-process, after the endpoint's chain", async () => {
    const result = await (await connect()).callTool({
      name: "whoAmI",
      arguments: { shout: "yes" },
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      result: "success",
      statusCode: 200,
      account: "ANN",
    });
  });

  it("sends an optional part the agent left empty as {}", async () => {
    const result = await (await connect()).callTool({
      name: "datasets_count",
      arguments: {},
    });
    expect(result.structuredContent).toMatchObject({ result: "success", count: 2 });
  });

  it("calls a picked route with what inject gives, once per MCP request", async () => {
    const client = await connect();
    injected.mockClear();
    const created = await client.callTool({
      name: "posts_create",
      arguments: { title: "Hi", status: "live" },
    });
    expect(text(created)).toEqual({
      result: "success",
      statusCode: 200,
      title: "Hi",
      by: "ann",
    });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(injected).toHaveBeenCalledWith("ann");

    const removed = await client.callTool({
      name: "posts_remove",
      arguments: { id: "3" },
    });
    expect(text(removed)).toMatchObject({ result: "success", removed: 3 });
  });

  it("an agent can't override what inject gives", async () => {
    const result = await (await connect()).callTool({
      name: "posts_create",
      arguments: {
        title: "Hi",
        status: "live",
        authorization: "Bearer t-123",
        headers: "x",
      },
    });
    expect(text(result)).toMatchObject({ result: "success", by: "ann" });

    // Bob's inject gives a token the route refuses, whatever he sends.
    const bob = await (await connect("k-bob")).callTool({
      name: "posts_create",
      arguments: { title: "Hi", status: "live", authorization: "Bearer t-123" },
    });
    expect(bob.isError).toBe(true);
    expect(text(bob)).toMatchObject({ result: "forbidden", statusCode: 403 });
  });

  it("returns validation errors as tool errors", async () => {
    const result = await (await connect()).callTool({
      name: "posts_create",
      arguments: { title: "Hi", status: "gone" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ result: "invalid-body", statusCode: 422 });
  });

  it("returns the endpoint, its tools and the picked routes", () => {
    expect(mcp.mcp._kind).toBe("raw");
    expect(mcp.tools.whoAmI._kind).toBe("json");
    expect(mcp.routes.posts.create).toBe(appRoutes.posts.create);
  });
});

describe("which endpoints can be tools", () => {
  const app = express();
  const b = createBuilder(app);
  const json = b.get(async () => success({}));
  const sse = b.getSSE(async function* () {
    yield { n: 1 };
  });
  const raw = b.getRaw(async ({ res }) => void res.end());
  const bytes = b.rawBody().post(async () => success({}));

  it("are the JSON ones; the rest fail to compile and at startup", () => {
    const inject = async () => ({});
    expect(() =>
      createMcpEndpoint(b.path("/a"), { routes: { pick: { json }, inject } }),
    ).not.toThrow();
    expect(() =>
      // @ts-expect-error SSE endpoints can't be MCP tools
      createMcpEndpoint(b.path("/b"), { routes: { pick: { sse }, inject } }),
    ).toThrow(/sse: SSE endpoints/);
    expect(() =>
      // @ts-expect-error raw endpoints can't be MCP tools
      createMcpEndpoint(b.path("/c"), { routes: { pick: { group: { raw } }, inject } }),
    ).toThrow(/group.raw: raw endpoints/);
    expect(() =>
      // @ts-expect-error rawBody() endpoints can't be MCP tools
      createMcpEndpoint(b.path("/d"), { routes: { pick: { bytes }, inject } }),
    ).toThrow(/bytes: rawBody\(\) endpoints/);
    expect(() =>
      createMcpEndpoint(b.path("/e"), {
        // @ts-expect-error not as its own tools either
        tools: (t) => ({ s: t.getSSE(async function* () {}) }),
      }),
    ).toThrow(/s: SSE endpoints/);
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
