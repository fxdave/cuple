import {
  CupleTransportError,
  CupleUnexpectedResponseError,
  fetchCuple,
} from "@cuple/client";
import { apiResponse, success } from "@cuple/server";
import express from "express";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";

const routes = (builder: Parameters<Parameters<typeof createClientAndServer>[0]>[0]) => ({
  getOrder: builder
    .paramsSchema(z.object({ id: z.number() }))
    .get(async ({ data }) =>
      data.params.id === 1
        ? success({ title: "Desk" })
        : data.params.id === 2
          ? apiResponse("not-found-error", 404, { message: "gone" })
          : apiResponse("forbidden-error", 403, { message: "not yours" }),
    ),
});

describe("thenResolveAlso", () => {
  it("keeps success and the listed results", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      const ok = await fetchCuple(client.getOrder.get, {
        params: { id: 1 },
      }).thenResolveAlso(["not-found-error"]);
      const missing = await fetchCuple(client.getOrder.get, {
        params: { id: 2 },
      }).thenResolveAlso(["not-found-error"]);
      expect(ok.result).toBe("success");
      expect(missing.result).toBe("not-found-error");
    });
  });

  it("rejects the unlisted ones as CupleUnexpectedResponseError", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      await expect(
        fetchCuple(client.getOrder.get, { params: { id: 3 } }).thenResolveAlso([
          "not-found-error",
        ]),
      ).rejects.toBeInstanceOf(CupleUnexpectedResponseError);
    });
  });
});

describe("thenResolveOn", () => {
  it("is the complete list: success is not implied", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      const missing = await fetchCuple(client.getOrder.get, {
        params: { id: 2 },
      }).thenResolveOn(["not-found-error"]);
      expect(missing.result).toBe("not-found-error");
      await expect(
        fetchCuple(client.getOrder.get, { params: { id: 1 } }).thenResolveOn([
          "not-found-error",
        ]),
      ).rejects.toBeInstanceOf(CupleUnexpectedResponseError);
    });
  });
});

describe("CupleTransportError", () => {
  it("wraps an unreachable server, keeping the original as cause", async () => {
    const { createClient } = await import("@cuple/client");
    const offline = createClient<ReturnType<typeof routes>>({
      path: "http://localhost:1/rpc",
    });
    const error = await fetchCuple(offline.getOrder.get, { params: { id: 1 } }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(CupleTransportError);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.statusCode).toBeNull();
  });

  it("wraps a body that is not JSON, with its status code", async () => {
    const app = express();
    app.use("/rpc", (_req, res) => {
      res.status(502).send("<html>Bad Gateway</html>");
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { createClient } = await import("@cuple/client");
    const port = (server.address() as { port: number }).port;
    const gateway = createClient<ReturnType<typeof routes>>({
      path: `http://localhost:${port}/rpc`,
    });
    const error = await fetchCuple(gateway.getOrder.get, { params: { id: 1 } }).catch(
      (e) => e,
    );
    server.close();
    expect(error).toBeInstanceOf(CupleTransportError);
    expect(error.statusCode).toBe(502);
  });

  it("leaves an abort as AbortError: it is a decision, not a failure", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      const controller = new AbortController();
      controller.abort();
      const error = await fetchCuple(client.getOrder.get, {
        params: { id: 1 },
        options: { signal: controller.signal },
      }).catch((e) => e);
      expect(error).not.toBeInstanceOf(CupleTransportError);
      expect(error.name).toBe("AbortError");
    });
  });
});

describe('"transport-error": network failures as a listed result', () => {
  it("resolves as a value when listed, typed like any result", async () => {
    const { createClient } = await import("@cuple/client");
    const offline = createClient<ReturnType<typeof routes>>({
      path: "http://localhost:1/rpc",
    });
    const res = await fetchCuple(offline.getOrder.get, {
      params: { id: 1 },
    }).thenResolveAlso(["transport-error"]);
    expect(res.result).toBe("transport-error");
    if (res.result === "transport-error") {
      expect(res.statusCode).toBeNull();
      expect(res.message).toMatch(/could not be reached/);
    }
  });

  it("still rejects as CupleTransportError when not listed", async () => {
    const { createClient } = await import("@cuple/client");
    const offline = createClient<ReturnType<typeof routes>>({
      path: "http://localhost:1/rpc",
    });
    await expect(
      fetchCuple(offline.getOrder.get, { params: { id: 1 } }).thenResolveAlso([
        "not-found-error",
      ]),
    ).rejects.toBeInstanceOf(CupleTransportError);
  });

  it("works with thenResolveOn too, and only when listed", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      const ok = await fetchCuple(client.getOrder.get, {
        params: { id: 2 },
      }).thenResolveOn(["not-found-error", "transport-error"]);
      expect(ok.result).toBe("not-found-error");
    });
  });

  it("types: transport-error can be listed on any endpoint", async () => {
    const cs = await createClientAndServer(routes);
    await cs.run(async (client) => {
      const res = await fetchCuple(client.getOrder.get, {
        params: { id: 1 },
      }).thenResolveAlso(["transport-error"]);
      const result: "success" | "transport-error" = res.result;
      // @ts-expect-error not listed, so not in the type
      const other: "not-found-error" = res.result;
      void [result, other];
    });
  });
});
