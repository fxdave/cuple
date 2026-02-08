import { describe, it, assert } from "vitest";
import { success } from "@cuple/server";
import { fetchCuple } from "@cuple/client";
import createClientAndServer from "../utils/createClientAndServer";
import { z } from "zod/v4";
import { Worker } from "worker_threads";

describe("racecondition test", () => {
  it("should work", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder.get(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return success({
          foo: "hi",
        });
      }),
    }));
    await cs.run(async (client) => {
      const req1 = fetchCuple(client.foo.get, {});
      const req2 = fetchCuple(client.foo.get, {});

      const [response1, response2] = await Promise.all([req1, req2]);

      if (response1.result !== "success") assert.ok(false);
      if (response2.result !== "success") assert.ok(false);
      assert.equal(response1.foo, "hi");
      assert.equal(response2.foo, "hi");
    });
  });
  it("should work with timeouts", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder
        .bodySchema(
          z.strictObject({
            timeout: z.number(),
          }),
        )
        .post(async ({ data }) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return success({
            foo: `hi ${data.body.timeout}`,
          });
        }),
    }));
    await cs.run(async (client) => {
      await Promise.all(
        [0, 10, 20, 30, 40].map(async (timeout) => {
          await new Promise((resolve) => setTimeout(resolve, timeout));
          const res = await fetchCuple(client.foo.post, {
            body: {
              timeout,
            },
          });

          if (res.result !== "success") assert.ok(false);
          assert.equal(res.foo, `hi ${timeout}`);
        }),
      );
    });
  });
  it("should work with path sharing", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder.get(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return success({
          foo: "hi",
        });
      }),
    }));
    await cs.run(async (client) => {
      const path = client.foo.get;
      const req1 = fetchCuple(path, {});
      const req2 = fetchCuple(path, {});

      const [response1, response2] = await Promise.all([req1, req2]);

      if (response1.result !== "success") assert.ok(false);
      if (response2.result !== "success") assert.ok(false);
      assert.equal(response1.foo, "hi");
      assert.equal(response2.foo, "hi");
    });
  });
});
