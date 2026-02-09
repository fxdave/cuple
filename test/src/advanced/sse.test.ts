import assert from "assert";
import { describe, it } from "vitest";
import { z } from "zod";
import { success } from "@cuple/server";
import { fetchCuple, fetchCupleSSE } from "@cuple/client";
import createClientAndServer from "../utils/createClientAndServer";

describe("SSE handlers", () => {
  it("should stream basic SSE events", async () => {
    const cs = await createClientAndServer((builder) => ({
      feed: builder.getSSE(async function* () {
        yield { n: 1 };
        yield { n: 2 };
        yield { n: 3 };
      }),
    }));

    await cs.run(async (client) => {
      const stream = await fetchCupleSSE(client.feed.get).thenUnwrap();
      const events: { n: number }[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      assert.deepEqual(events, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    });
  });

  it("should pass middleware data to SSE generator", async () => {
    const cs = await createClientAndServer((builder) => ({
      feed: builder
        .middleware(async () => ({
          next: true as const,
          user: "alice",
        }))
        .getSSE(async function* ({ data }) {
          yield { greeting: `hello ${data.user}` };
        }),
    }));

    await cs.run(async (client) => {
      const stream = await fetchCupleSSE(client.feed.get).thenUnwrap();
      const events: { greeting: string }[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      assert.deepEqual(events, [{ greeting: "hello alice" }]);
    });
  });

  it("should return middleware error when middleware rejects", async () => {
    const cs = await createClientAndServer((builder) => ({
      feed: builder
        .middleware(async () => ({
          next: false as const,
          statusCode: 403,
          result: "forbidden" as const,
          message: "not allowed",
        }))
        .getSSE(async function* () {
          yield { n: 1 };
        }),
    }));

    await cs.run(async (client) => {
      const response = await fetchCupleSSE(client.feed.get);
      assert.equal(response.result, "forbidden");
      assert.equal(response.statusCode, 403);
    });
  });

  it("should call generator.return() on client disconnect by default", async () => {
    let generatorReturned = false;

    const cs = await createClientAndServer((builder) => ({
      feed: builder.path("/feed").getSSE(async function* () {
        try {
          let i = 0;
          while (true) {
            yield { n: i++ };
            await new Promise((r) => setTimeout(r, 50));
          }
        } finally {
          generatorReturned = true;
        }
      }),
    }));

    await cs.run(async (_client, url) => {
      const controller = new AbortController();
      const response = await fetch(`${url}/feed`, {
        signal: controller.signal,
      });
      assert.equal(response.status, 200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      try {
        while (received < 2) {
          const { value } = await reader.read();
          const text = decoder.decode(value, { stream: true });
          if (text.includes("data:")) received++;
        }
      } finally {
        reader.releaseLock();
      }
      controller.abort();

      await new Promise((r) => setTimeout(r, 200));
      assert.equal(generatorReturned, true);
    });
  });

  it("should NOT call generator.return() when returnOnDisconnect is false", async () => {
    let generatorReturned = false;
    let generatorFinished = false;

    const cs = await createClientAndServer((builder) => ({
      feed: builder.path("/feed").getSSE(
        async function* () {
          try {
            for (let i = 0; i < 5; i++) {
              yield { n: i };
              await new Promise((r) => setTimeout(r, 30));
            }
            generatorFinished = true;
          } finally {
            if (!generatorFinished) {
              generatorReturned = true;
            }
          }
        },
        { returnOnDisconnect: false },
      ),
    }));

    await cs.run(async (_client, url) => {
      const controller = new AbortController();
      const response = await fetch(`${url}/feed`, {
        signal: controller.signal,
      });
      assert.equal(response.status, 200);

      const reader = response.body!.getReader();
      await reader.read();
      reader.releaseLock();
      controller.abort();

      await new Promise((r) => setTimeout(r, 500));
      assert.equal(generatorReturned, false);
      assert.equal(generatorFinished, true);
    });
  });

  it("should work through RPC via fetchCupleSSE", async () => {
    const cs = await createClientAndServer((builder) => ({
      counter: builder.getSSE(async function* () {
        yield { count: 1 };
        yield { count: 2 };
      }),
      normal: builder.get(async () => success({ ok: true })),
    }));

    await cs.run(async (client) => {
      const stream = await fetchCupleSSE(client.counter.get).thenUnwrap();
      const events: { count: number }[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      assert.deepEqual(events, [{ count: 1 }, { count: 2 }]);

      const normal = await fetchCuple(client.normal.get);
      assert.equal(normal.result, "success");
    });
  });
});
