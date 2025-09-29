import assert from "assert";
import { describe, it } from "mocha";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("raw handlers", () => {
  it("should work along with normal handlers", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder.path("/test").getRaw(async ({ req, res }) => {
        res.status(200).send("text-response");
      }),
      testNormal: builder.get(async () => {
        return success({});
      }),
    }));
    await cs.run(async (client) => {
      const response = await fetch("http://localhost:8080/test");
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text, "text-response");

      const normalRequest = await client.testNormal.get({});
      assert.equal(normalRequest.result, "success");
    });
  });

  it("should get middleware data", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder
        .path("/test")
        .middleware(async () => {
          return {
            next: true,
            foo: "hello",
          };
        })
        .getRaw(async ({ req, res, data }) => {
          res.status(200).send(data.foo);
        }),
    }));
    await cs.run(async (client) => {
      const response = await fetch("http://localhost:8080/test");
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text, "hello");
    });
  });

  it("should get middleware responses", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder
        .path("/test")
        .middleware(async () => {
          // eslint-disable-next-line no-constant-condition
          if (1 < 0.5)
            return {
              next: true,
              bar: "hey",
            };
          return {
            next: false,
            statusCode: 400,
            foo: "hello",
          };
        })
        .getRaw(async ({ req, res, data }) => {
          if (data.next === false) {
            res.status(data.statusCode).send(data.foo);
          } else {
            res.status(200).send(data.foo);
          }
        }),
    }));
    await cs.run(async (client) => {
      const response = await fetch("http://localhost:8080/test");
      assert.equal(response.status, 400);
      const text = await response.text();
      assert.equal(text, "hello");
    });
  });
});
