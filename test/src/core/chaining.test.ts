import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("chaining", () => {
  it("should include a complete chain as it was there", async () => {
    const cs = await createClientAndServer((builder) => {
      const link = builder
        .headersSchema(
          z.object({
            authorization: z.string(),
          }),
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
          }),
        )
        .buildLink();
      const link2 = builder
        .bodySchema(
          z.object({
            name: z.string(),
          }),
        )
        .buildLink();
      return {
        someRoute: builder
          .chain(link1)
          .chain(link2)
          .get(async ({ data }) => {
            return success({
              gotId: data.body.id,
              gotName: data.body.name,
            });
          }),
      };
    });
    await cs.run(async (client) => {
      const response = await client.someRoute.get({
        body: {
          id: 32,
          name: "David",
        },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.gotId, 32);
      assert.equal(response.gotName, "David");
    });
  });

  it("should be easy to create dependent chains", async () => {
    const cs = await createClientAndServer((builder) => {
      const link1 = builder
        .bodySchema(
          z.object({
            id: z.number(),
          }),
        )
        .buildLink();
      const link2 = builder
        .bodySchema(
          z.object({
            age: z.number(),
          }),
        )
        .buildLink();
      const link3 = builder
        .expectChain<typeof link1>()
        .expectChain<typeof link2>()
        .bodySchema(
          z.object({
            name: z.string(),
          }),
        )
        .middleware(async ({ data }) => {
          return {
            gotIdFromPreviousMiddleware: data.body.id,
            gotAgeFromPreviousMiddleware: data.body.age,
            next: true,
          };
        })
        .buildLink();
      return {
        someRoute: builder
          .chain(link1)
          .chain(link2)
          .chain(link3)
          .get(async ({ data }) => {
            return success({
              gotId: data.body.id,
              gotName: data.body.name,
              gotIdFromPreviousMiddleware: data.gotIdFromPreviousMiddleware,
              gotAgeFromPreviousMiddleware: data.gotAgeFromPreviousMiddleware,
            });
          }),
      };
    });
    await cs.run(async (client) => {
      const response = await client.someRoute.get({
        body: {
          id: 32,
          name: "David",
          age: 100,
        },
      });
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.gotId, 32);
      assert.equal(response.gotName, "David");
      assert.equal(response.gotIdFromPreviousMiddleware, 32);
      assert.equal(response.gotAgeFromPreviousMiddleware, 100);
    });
  });

  it("should type-check whether a middleware is missing a dependent middleware", async () => {
    await assert.rejects(async () => {
      const cs = await createClientAndServer((builder) => {
        const link1 = builder
          .bodySchema(
            z.object({
              id: z.number(),
            }),
          )
          .buildLink();
        const link2 = builder
          .expectChain<typeof link1>()
          .bodySchema(
            z.object({
              name: z.string(),
            }),
          )
          .middleware(async ({ data }) => {
            return {
              gotIdFromPreviousMiddleware: data.body.id,
              next: true,
            };
          })
          .buildLink();
        return {
          // @ts-expect-error link2 should miss link1
          someRoute: builder.chain(link2).get(async ({ data }) => {
            return success({
              gotId: data.body.id,
              gotName: data.body.name,
              gotIdFromPreviousMiddleware: data.gotIdFromPreviousMiddleware,
            });
          }),
        };
      });
      await cs.run(async (client) => {
        const response = await client.someRoute.get({
          body: {
            id: 32,
            name: "David",
          },
        });
        if (response.result !== "success") assert.ok(false);
        assert.equal(response.gotId, 32);
        assert.equal(response.gotName, "David");
        assert.equal(response.gotIdFromPreviousMiddleware, 32);
      });
    });
  });
});
