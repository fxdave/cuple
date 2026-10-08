import { CupleUnexpectedResponseError, fetchCuple } from "@cuple/client";
import { success } from "@cuple/server";
import { assert, describe, it } from "vitest";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";

describe("CuplePromise", () => {
  it("should allow chaining then methods", async () => {
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
      const response = await fetchCuple(client.exampleRoute.get, {
        query: {
          name: "David",
        },
      })
        .thenKeep(["success", "invalid-query"])
        .thenKeepSuccess()
        .thenKeepAlso(["abort"]);

      if (response.result === "abort") {
        return assert.ok(false);
      } else if (response.result === "success") {
        return assert.ok(true);
      }
      assert.ok(false);
    });
  });
  it("thenKeep invalid-query", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string().min(3),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const responsePromise = fetchCuple(client.exampleRoute.get, {
        query: {
          name: "An",
        },
      });

      try {
        await responsePromise.thenKeep(["success"]);
        assert.ok(false, 'The response should not be "success"');
      } catch (e) {
        assert.ok(true);
      }

      try {
        await responsePromise.thenKeep(["invalid-query"]);
        assert.ok(true);
      } catch (e) {
        assert.ok(
          false,
          'The response should be "invalid-query" so unwraping it should work',
        );
      }
    });
  });
  it("resolves invalid-query by default", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string().min(3),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const responsePromise = fetchCuple(client.exampleRoute.get, {
        query: {
          name: "An",
        },
      });

      const response = await responsePromise;
      assert.equal(response.result, "invalid-query");
    });
  });

  it("thenKeep success", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string().min(3),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const responsePromise = fetchCuple(client.exampleRoute.get, {
        query: {
          name: "David",
        },
      });

      try {
        await responsePromise.thenKeep(["invalid-query"]);
        assert.ok(false, 'The response should not be "invalid-query"');
      } catch (e) {
        assert.ok(true);
      }

      try {
        await responsePromise.thenKeep(["success"]);
        assert.ok(true);
      } catch (e) {
        assert.ok(false, 'The response should be "success" so unwraping it should work');
      }
    });
  });
  it("resolves success by default", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string().min(3),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const responsePromise = fetchCuple(client.exampleRoute.get, {
        query: {
          name: "David",
        },
      });

      try {
        await responsePromise;
        assert.ok(true);
      } catch (e) {
        assert.ok(false, 'The response should be "success"');
      }
    });
  });
});
