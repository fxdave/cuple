import assert from "assert";
import { describe, it } from "mocha";
import { success } from "../../src/server/responses";
import createClientAndServer from "../utils/createClientAndServer";

describe("middleware", () => {
  it("should return an independent response from the middleware", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: true,
            foo: "hello",
          };
        })
        .get(async () => {
          return success({
            foo: "hi",
          });
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      assert.equal(response.foo, "hi");
    });
  });
  it("should not return any middleware data", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: true,
            foo: "hello",
          };
        })
        .get(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      assert.equal((response as any).foo, undefined);
    });
  });
  it("should return middleware response only if next: false", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: false,
            statusCode: 400 as const,
            foo: "hello",
          };
        })
        .get(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      assert.equal(response.statusCode, 400);
      if (response.statusCode === 400) assert.equal(response.foo, "hello");
    });
  });
});
