import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("schema validation", () => {
  it("should validate body schema", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.object({
            id: z.number(),
          })
        )
        .post(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({} as any);
      assert.equal(response.statusCode, 422);
      if (response.result !== "validation-error") assert.ok(false);
      assert.notEqual(response.message.length, 0);
      assert.ok(Array.isArray(response.issues[0].path));
    });
  });

  it("should allow non-objects", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder.bodySchema(z.number()).post(async ({ data }) => {
        return success({
          got: data.body,
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        body: 42,
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.got, 42);
    });
  });

  it("should validate query parameters schema", async () => {
    // TODO: ideally, this should fail because every query param is string.
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .querySchema(
          z.object({
            id: z.number(),
          })
        )
        .post(async ({ data }) => {
          return success({
            got: data.query.id,
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        query: { id: 42 },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.got, 42);
    });
  });

  it("should validate url params schema", async () => {
    // TODO: ideally, this should fail because every url param is string.
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .paramsSchema(
          z.object({
            id: z.number(),
          })
        )
        .post(async ({ data }) => {
          return success({
            got: data.params.id,
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        params: { id: 42 },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.got, 42);
    });
  });

  it("should validate header schema", async () => {
    // TODO: ideally, this should fail because every header is string or string[].
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .headersSchema(
          z.object({
            authorization: z.number(),
          })
        )
        .post(async ({ data }) => {
          return success({
            got: data.headers.authorization,
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        headers: {
          authorization: 42,
        },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.got, 42);
    });
  });
});
