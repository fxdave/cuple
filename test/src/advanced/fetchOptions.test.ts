import { CupleUnexpectedResponseError, fetchCuple } from "@cuple/client";
import { success } from "@cuple/server";
import { assert, describe, it } from "vitest";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";

describe("Fetch options", () => {
  it("should work with AbortController", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string(),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const controller = new AbortController();
      const newClient = client.with({
        middleware: () => ({
          query: {
            name: "David",
          },
        }),
      });

      try {
        const responsePromise = fetchCuple(newClient.exampleRoute.get, {
          options: {
            signal: controller.signal,
          },
        }).thenResolveAll();
        controller.abort();
        await responsePromise;
      } catch (e) {
        assert.ok(e instanceof DOMException && e.name === "AbortError");
        return;
      }

      assert.ok(false, "AbortError is expected");
    });
  });

  it("should work with AbortController wrapped", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string(),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const controller = new AbortController();
      const newClient = client.with({
        middleware: () => ({
          query: {
            name: "David",
          },
        }),
      });

      const responsePromise = fetchCuple(newClient.exampleRoute.get, {
        options: {
          signal: controller.signal,
        },
      })
        .thenResolveAll()
        .thenWrapAbort();
      controller.abort();
      const response = await responsePromise;
      assert.equal(response.result, "abort");
    });
  });
});
