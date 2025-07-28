import { success } from "@cuple/server";
import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";

describe("client.with(..) (aka Client chaining)", () => {
  it("should fulfil the request data requirements", async () => {
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
      const newClient = client.with(() => ({
        query: {
          name: "David",
        },
      }));

      const response = await newClient.exampleRoute.get({});
      assert.equal(response.message, "Hi David!");
    });
  });

  it("should extend the request data", async () => {
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
      const newClient = client.with(() => ({
        query: {
          name: "David",
        },
      }));

      const response = await newClient.exampleRoute.get({
        query: {
          name: "Foo",
        },
      });
      assert.equal(response.message, "Hi Foo!");
    });
  });

  it("should handle async functions", async () => {
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
      const newClient = client.with(async () => ({
        query: {
          name: "David",
        },
      }));

      const response = await newClient.exampleRoute.get({
        query: {
          name: "Foo",
        },
      });
      assert.equal(response.message, "Hi Foo!");
    });
  });
});
