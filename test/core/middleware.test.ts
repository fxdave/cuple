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
            bar: 42,
          };
        })
        .get(async () => {
          assert.ok(false, "This should not be called");
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      if (response.statusCode !== 400)
        assert.ok(false, "statusCode should be 400");
      assert.equal(response.foo, "hello");
      assert.equal(response.bar, "42");
    });
  });

  it("should keep the order of middlewares 1", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: false,
            statusCode: 400 as const,
            mw: 1,
          };
        })
        .middleware(async () => {
          return {
            next: false,
            statusCode: 400 as const,
            mw: 2,
          };
        })
        .get(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      if (response.statusCode !== 400)
        assert.ok(false, "statusCode should be 400");
      assert.equal(response.mw, 1);
    });
  });

  it("should keep the order of middlewares 2", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: true,
          };
        })
        .middleware(async () => {
          return {
            next: false,
            statusCode: 400 as const,
            mw: 2,
          };
        })
        .get(async () => {
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      if (response.statusCode !== 400)
        assert.ok(false, "statusCode should be 400");
      assert.equal(response.mw, 2);
    });
  });

  it("should pass data from top to bottom", async () => {
    let tested = false;
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: true,
            foo: 1,
          };
        })
        .middleware(async ({ data }) => {
          assert.equal(data.foo, 1);
          return {
            next: true,
            bar: 2,
          };
        })
        .get(async ({ data }) => {
          assert.equal(data.foo, 1);
          assert.equal(data.bar, 2);
          tested = true;
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      assert.equal(response.result, "success");
    });
    assert.equal(tested, true);
  });

  it("should overwrite previous middleware data if the name is matching", async () => {
    let tested = false;
    const cs = await createClientAndServer((builder) => ({
      get: builder
        .middleware(async () => {
          return {
            next: true,
            foo: 1,
          };
        })
        .middleware(async ({ data }) => {
          assert.equal(data.foo, 1);
          return {
            next: true,
            foo: 2,
          };
        })
        .get(async ({ data }) => {
          assert.equal(data.foo, 2);
          tested = true;
          return success({});
        }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      assert.equal(response.result, "success");
    });
    assert.equal(tested, true);
  });
});
