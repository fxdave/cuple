import { describe, it, assert } from "vitest";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("500 Internal Server Error handling", () => {
  it("should handle 500 errors by default", async () => {
    const cs = await createClientAndServer((builder) => ({
      getMathError: builder.get(async () => {
        return success({
          something: (undefined as unknown as any).something,
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await client.getMathError.get({});
      assert.equal(response.result, "unexpected-error");
      assert.equal(response.statusCode, 500);
    });
  });

  it("should allow overwriting error handler", async () => {
    const cs = await createClientAndServer(
      (builder) => ({
        getMathError: builder.get(async () => {
          return success({
            something: (undefined as unknown as any).something,
          });
        }),
      }),
      {
        errorHandler: ({ err }) => {
          let errorObject;
          if (err instanceof Error)
            errorObject = JSON.stringify(err, Object.getOwnPropertyNames(err));

          return {
            statusCode: 500,
            message: "Something went wrong",
            result: "unexpected-error",
            errorObject,
            foo: 42,
          };
        },
      },
    );
    await cs.run(async (client) => {
      const response = await client.getMathError.get({});
      assert.equal(response.result, "unexpected-error");
      assert.equal((response as any).foo, 42);
    });
  });

  it("should fallback to default error handler in case of error", async () => {
    const cs = await createClientAndServer(
      (builder) => ({
        getMathError: builder.get(async () => {
          return success({
            something: (undefined as unknown as any).something,
          });
        }),
      }),
      {
        errorHandler: () => {
          (undefined as unknown as any).something;
          return {
            statusCode: 500,
            message: "Something went wrong",
            result: "unexpected-error",
            foo: 42,
          };
        },
      },
    );
    await cs.run(async (client) => {
      const response = await client.getMathError.get({});
      assert.equal(response.result, "unexpected-error");
      assert.equal((response as any).foo, undefined);
    });
  });
});
