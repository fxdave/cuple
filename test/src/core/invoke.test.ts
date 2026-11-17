import type { Server } from "node:http";
import { createClient, fetchCuple } from "@cuple/client";
import { apiResponse, createBuilder, initRpc, success } from "@cuple/server";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const app = express();
const builder = createBuilder(app, {
  errorHandler: () => ({
    result: "unexpected-error",
    statusCode: 500,
    message: "handled",
  }),
});
const tokenSchema = z.object({ authorization: z.string() });
const auth = builder
  .headersSchema(tokenSchema)
  .middleware(async ({ data }) =>
    data.headers.authorization === "Bearer ok"
      ? { next: true as const, user: "ann" }
      : { next: false as const, statusCode: 401, result: "unauthorized" as const },
  )
  .buildLink();
const bodySchema = z.object({ title: z.string() });

const routes = {
  create: builder
    .meta({ description: "Creates", readOnly: false })
    .chain(auth)
    .bodySchema(bodySchema)
    .post(async ({ data }) =>
      data.body.title === "boom"
        ? (() => {
            throw new Error("boom");
          })()
        : data.body.title === "taken"
          ? apiResponse("conflict", 409, { message: "Taken" })
          : success({ title: data.body.title, by: data.user }),
    ),
};
initRpc(app, { path: "/rpc", routes });

let http: Server;
let client: ReturnType<typeof createClient<typeof routes>>;
beforeAll(async () => {
  http = app.listen(0);
  await new Promise((resolve) => http.once("listening", resolve));
  client = createClient<typeof routes>({
    path: `http://localhost:${(http.address() as { port: number }).port}/rpc`,
  });
});
afterAll(() => http.close());

describe("what a built endpoint keeps at runtime", () => {
  it("its meta, its kind, and the schemas of its chain, links included", () => {
    expect(routes.create._meta).toEqual({ description: "Creates", readOnly: false });
    expect(routes.create._kind).toBe("json");
    expect(routes.create._rawBody).toBe(false);
    expect(routes.create._inputs).toEqual([
      { part: "headers", schema: tokenSchema },
      { part: "body", schema: bodySchema },
    ]);
    expect(builder.chain(auth)._chain).toEqual({ middlewares: 1, inputs: 1 });
  });
});

describe("_invoke", () => {
  const cases = [
    { headers: { authorization: "Bearer ok" }, body: { title: "Hi" } },
    { headers: { authorization: "Bearer no" }, body: { title: "Hi" } },
    { headers: { authorization: "Bearer ok" }, body: { title: 1 } },
    { headers: { authorization: "Bearer ok" }, body: { title: "taken" } },
    { headers: { authorization: "Bearer ok" }, body: { title: "boom" } },
  ];

  it("answers what the RPC endpoint answers", async () => {
    for (const input of cases) {
      const viaRpc = await fetchCuple(client.create.post, input as any);
      expect(await routes.create._invoke!(input)).toEqual({ ...viaRpc });
    }
  });

  it("can start after the middlewares that already ran", async () => {
    const result = await routes.create._invoke!(
      { body: { title: "Hi" } },
      { skip: 1, data: { user: "bob" } },
    );
    expect(result).toEqual({
      result: "success",
      statusCode: 200,
      title: "Hi",
      by: "bob",
    });
  });

  it("inherits the rest of the request it's given", async () => {
    const seen: unknown[] = [];
    const probe = builder.get(async ({ req }) => {
      seen.push(req.ip, req.headers);
      return success({});
    });
    const base = Object.assign(Object.create(null), {
      ip: "10.0.0.1",
      headers: { secret: "x" },
    });
    await probe._invoke!({ headers: { a: "1" } }, { req: base });
    expect(seen).toEqual(["10.0.0.1", { a: "1" }]);
  });
});
