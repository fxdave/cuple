import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import { success } from "../../src/server/responses";
import createClientAndServer from "../utils/createClientAndServer";

describe("chaining", () => {
  it("should include a complete chain as it was there", async () => {
    const cs = await createClientAndServer((builder) => {
      const link = builder
        .headersSchema(
          z.object({
            authorization: z.string(),
          })
        )
        .middleware(async ({ data }) => {
          if (data.headers.authorization === "foo")
            return {
              next: true,
            };
          return {
            next: false,
            statusCode: 401 as const,
          };
        })
        .buildLink();
      return {
        get: builder.chain(link).get(async () => {
          return success({
            message: "hi",
          });
        }),
      };
    });
    await cs.run(async (client) => {
      const badResponse1 = await client.get.get({
        headers: {
          authorization: "bar",
        },
      });
      assert.equal(badResponse1.statusCode, 401);

      const badResponse2 = await client.get.get({
        headers: {} as any,
      });
      assert.equal(badResponse2.statusCode, 422);

      const badResponse3 = await client.get.get({} as any);
      assert.equal(badResponse3.statusCode, 422);

      const response = await client.get.get({
        headers: {
          authorization: "foo",
        },
      });
      if (response.statusCode !== 200) assert.ok(false);
      assert.equal(response.message, "hi");
    });
  });

  it("should be possible to include multiple chains", async () => {
    const cs = await createClientAndServer((builder) => {
      const link1 = builder
        .bodySchema(
          z.object({
            id: z.number(),
          })
        )
        .buildLink();
      const link2 = builder
        .bodySchema(
          z.object({
            name: z.string(),
          })
        )
        .buildLink();
      return {
        someRoute: builder
          .chain(link1)
          .chain(link2)
          .get(async ({ data }) => {
            return success({
              gotId: data.body.id,
              gotName: data.body.name
            });
          }),
      };
    });
    await cs.run(async (client) => {
      const response = await client.someRoute.get({
        body: {
          id: 32,
          name: "David"
        }
      });
      if(response.result !== "success") assert.ok(false)
      assert.equal(response.gotId, 32);
      assert.equal(response.gotName, "David");
    });
  });
});
