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
        .thenResolveOn(["success", "validation-error"])
        .thenUnwrap()
        .thenWrapAbort();

      if (response.result === "abort") {
        return assert.ok(false);
      } else if (response.result === "success") {
        return assert.ok(true);
      }
      assert.ok(false);
    });
  });
  it("thenResolveOn validation-error", async () => {
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
        await responsePromise.thenResolveOn(["success"]);
        assert.ok(false, 'The response should not be "success"');
      } catch (e) {
        assert.ok(true);
      }

      try {
        await responsePromise.thenResolveOn(["validation-error"]);
        assert.ok(true);
      } catch (e) {
        assert.ok(
          false,
          'The response should be "validation-error" so unwraping it should work',
        );
      }
    });
  });
  it("thenUnwrap validation-error", async () => {
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
        await responsePromise.thenUnwrap();
        assert.ok(false, 'The response should not be "success"');
      } catch (e) {
        assert.ok(true);
      }
    });
  });

  it("thenResolveOn success", async () => {
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
        await responsePromise.thenResolveOn(["validation-error"]);
        assert.ok(false, 'The response should not be "validation-error"');
      } catch (e) {
        assert.ok(true);
      }

      try {
        await responsePromise.thenResolveOn(["success"]);
        assert.ok(true);
      } catch (e) {
        assert.ok(false, 'The response should be "success" so unwraping it should work');
      }
    });
  });
  it("thenUnwrap success", async () => {
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
        await responsePromise.thenUnwrap();
        assert.ok(true);
      } catch (e) {
        assert.ok(false, 'The response should be "success"');
      }
    });
  });
});
