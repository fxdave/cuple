import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import { success, zodValidationError } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("schema validation", () => {
  it("should validate body schema", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            id: z.number(),
          }),
        )
        .post(async () => {
          return success({
            message: "hey",
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({} as any);
      assert.equal(response.statusCode, 422);
      if (response.result !== "validation-error") return assert.ok(false);
      assert.notEqual(response.message.length, 0);
      assert.ok(Array.isArray(response.issues[0].path));
    });
  });
  it("should handle string date inputs", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            birthdate: z.iso.date(),
          }),
        )
        .post(async ({ data }) => {
          const time = data.body.birthdate.getTime();
          return success({ time });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        body: {
          birthdate: new Date().toString(),
        },
      });
      assert.equal(response.statusCode, 200);
    });
  });
  it("should handle date type date inputs", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            birthdate: z.coerce.date(),
          }),
        )
        .post(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        body: {
          birthdate: new Date(),
        },
      });
      assert.equal(response.statusCode, 200);
    });
  });
  it("should handle timestamp(ms) type date inputs", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            birthdate: z.coerce.date(),
          }),
        )
        .post(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        body: {
          birthdate: Date.now(),
        },
      });
      assert.equal(response.statusCode, 200);
    });
  });

  it("should validate mutli-level body schema", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            user: z.strictObject({
              address: z.strictObject({
                street: z.string(),
              }),
            }),
          }),
        )
        .post(async ({ data }) => {
          return success({
            street: data.body.user.address.street,
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({ user: { address: { street: 1 } } } as any);
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
          z.strictObject({
            id: z.number(),
          }),
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
          z.strictObject({
            id: z.number(),
          }),
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
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .headersSchema(
          z.strictObject({
            authorization: z.string(),
          }),
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
          authorization: "42",
        },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.got, 42);
    });
  });

  it("should support manual validationError", async () => {
    // TODO: ideally, this should fail because every header is string or string[].
    const cs = await createClientAndServer((builder) => ({
      foo: builder.post(async () => {
        return validationError({
          message: "hey",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({});

      if (response.result === "validation-error") {
        assert.ok(true);
      } else {
        assert.ok(false);
      }
    });
  });

  it("should support complex zodValidationError path", async () => {
    // TODO: ideally, this should fail because every header is string or string[].
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            name: z.string(),
          }),
        )
        .post(async ({ data }) => {
          if (data.body.name === "David") {
            return zodValidationError([
              {
                code: "custom",
                message: "No David here", // I'm David
                path: ["name"],
              },
            ]);
          }
          return success({
            message: `Hi ${data.body.name}`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.foo.post({
        body: { name: "David" },
      });

      if (response.result === "validation-error") {
        assert.equal(response.issues[0].path[0], "name");
      } else {
        assert.ok(false);
      }
    });
  });
});

const validationError = <Others extends { message: string }>(others: Others) => ({
  result: "validation-error" as const,
  statusCode: 422 as const,
  ...others,
});
