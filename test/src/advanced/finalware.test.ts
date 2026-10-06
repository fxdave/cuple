import {
  type CupleResult,
  type CupleSuccess,
  createClient,
  fetchCuple,
  fetchCupleSSE,
} from "@cuple/client";
import { apiResponse, success } from "@cuple/server";
import { assert, describe, expect, expectTypeOf, it } from "vitest";
import createClientAndServer from "../utils/createClientAndServer";

describe("client.with({ finalware })", () => {
  it("should see every response", async () => {
    const cs = await createClientAndServer((builder) => ({
      ok: builder.get(async () => success({ v: 1 })),
      gone: builder.get(async () => apiResponse("notFound", 404, { message: "no" })),
    }));
    await cs.run(async (client) => {
      const seen: string[] = [];
      const watched = client.with({ finalware: (res) => void seen.push(res.result) });

      await fetchCuple((watched as any).ok.get).thenResolveAnyResponse();
      await fetchCuple((watched as any).gone.get).thenResolveAnyResponse();
      assert.deepEqual(seen, ["success", "notFound"]);
    });
  });

  it("should keep the response when it returns nothing", async () => {
    const cs = await createClientAndServer((builder) => ({
      ok: builder.get(async () => success({ v: 1 })),
    }));
    await cs.run(async (client) => {
      const watched = client.with({ finalware: () => undefined });
      const res: any = await fetchCuple((watched as any).ok.get).thenResolveAnyResponse();
      assert.equal(res.result, "success");
      assert.equal(res.v, 1);
    });
  });

  it("should replace the response when it returns one", async () => {
    const cs = await createClientAndServer((builder) => ({
      ok: builder.get(async () => success({ v: 1 })),
    }));
    await cs.run(async (client) => {
      const watched = client.with({
        finalware: (res) => ({ ...res, v: res.v + 41 }),
      });
      const res: any = await fetchCuple((watched as any).ok.get).thenResolveAnyResponse();
      assert.equal(res.v, 42);
    });
  });

  it("should turn a result into an exception when it throws", async () => {
    const cs = await createClientAndServer((builder) => ({
      denied: builder.get(async () =>
        apiResponse("unauthorized", 401, { message: "expired" }),
      ),
    }));
    await cs.run(async (client) => {
      const watched = client.with({
        finalware: (res) => {
          if (res.statusCode === 401) throw new Error("redirect to login");
        },
      });
      await expect(
        fetchCuple((watched as any).denied.get).thenResolveAnyResponse(),
      ).rejects.toThrow("redirect to login");
    });
  });

  it("should await an async finalware", async () => {
    const cs = await createClientAndServer((builder) => ({
      ok: builder.get(async () => success({ v: 1 })),
    }));
    await cs.run(async (client) => {
      const watched = client.with({
        finalware: async (res) => {
          await new Promise((r) => setTimeout(r, 10));
          return { ...res, v: 99 };
        },
      });
      const res: any = await fetchCuple((watched as any).ok.get).thenResolveAnyResponse();
      assert.equal(res.v, 99);
    });
  });

  it("should run for SSE endpoints too", async () => {
    const cs = await createClientAndServer((builder) => ({
      feed: builder.getSSE(async function* () {
        yield { n: 1 };
      }),
    }));
    await cs.run(async (client) => {
      let seen: string | undefined;
      const watched = client.with({
        finalware: (res) => {
          seen = res.result;
        },
      });
      const stream: any = await fetchCupleSSE(
        (watched as any).feed.get,
      ).thenResolveAnyResponse();
      for await (const _ of stream) {
        // drain
      }
      assert.equal(seen, "success");
    });
  });

  it("should compose with middleware and key", async () => {
    const cs = await createClientAndServer((builder) => ({
      ok: builder.get(async () => success({ v: 1 })),
    }));
    await cs.run(async (client) => {
      const calls: string[] = [];
      const watched = client.with({
        key: "user-1",
        middleware: () => {
          calls.push("middleware");
          return {};
        },
        finalware: () => void calls.push("finalware"),
      });
      await fetchCuple((watched as any).ok.get).thenResolveAnyResponse();
      assert.deepEqual(calls, ["middleware", "finalware"]);
    });
  });
});

describe("result type helpers", () => {
  it("should narrow to the declared cases", async () => {
    const routes = {} as never;
    const client = createClient<typeof routes>({ path: "/rpc" });
    const endpoint = (client as any).getPost.get as {
      tInput: Record<string, unknown>;
      tOutput:
        | { result: "success"; post: string }
        | { result: "notFound"; message: string };
      tMethod: "get";
      clientProps: any;
    };

    expectTypeOf<CupleSuccess<typeof endpoint>>().toEqualTypeOf<{
      result: "success";
      post: string;
    }>();
    expectTypeOf<CupleResult<typeof endpoint>>().toEqualTypeOf<
      { result: "success"; post: string } | { result: "notFound"; message: string }
    >();
  });
});
