import assert from "assert";
import { describe, it } from "mocha";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("basic request response", () => {
  it("should receive the returned data for GET", async () => {
    const cs = await createClientAndServer((builder) => ({
      get: builder.get(async () => {
        return success({
          foo: "get",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.get.get({});
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.foo, "get");
    });
  });

  it("should return statusCode", async () => {
    const cs = await createClientAndServer((builder) => ({
      post: builder.post(async () => {
        return success({
          foo: "post",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.post.post({});
      assert.equal(response.statusCode, 200);
    });
  });

  it("should receive the returned data for POST", async () => {
    const cs = await createClientAndServer((builder) => ({
      post: builder.post(async () => {
        return success({
          foo: "post",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.post.post({});
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.foo, "post");
    });
  });

  it("should receive the returned data for PATCH", async () => {
    const cs = await createClientAndServer((builder) => ({
      patch: builder.patch(async () => {
        return success({
          foo: "patch",
        });
      }),
    }));

    await cs.run(async (client) => {
      const response = await client.patch.patch({});
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.foo, "patch");
    });
  });

  it("should receive the returned data for PUT", async () => {
    const cs = await createClientAndServer((builder) => ({
      put: builder.put(async () => {
        return success({
          foo: "put",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.put.put({});
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.foo, "put");
    });
  });

  it("should receive the returned data for DELETE", async () => {
    const cs = await createClientAndServer((builder) => ({
      delete: builder.delete(async () => {
        return success({
          foo: "delete",
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.delete.delete({});
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.foo, "delete");
    });
  });
});
