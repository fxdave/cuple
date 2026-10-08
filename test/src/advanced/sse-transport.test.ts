import { fetchCupleSSE } from "@cuple/client";
import { describe, expect, it } from "vitest";
import createClientAndServer from "../utils/createClientAndServer";

/**
 * How streams behave on the wire, where proxies and the browser's HTTP cache
 * sit between client and server.
 */
describe("SSE transport", () => {
  it("a quiet stream sends its first bytes at once, so a buffering proxy forwards the headers", async () => {
    const cs = await createClientAndServer((builder) => ({
      quiet: builder.getSSE(async function* ({ disconnectSignal }) {
        await new Promise((resolve) =>
          disconnectSignal.addEventListener("abort", resolve),
        );
      }),
    }));
    await cs.run(async (_client, url) => {
      const controller = new AbortController();
      const data = encodeURIComponent(JSON.stringify({ segments: ["quiet"] }));
      const response = await fetch(`${url}/rpc?data=${data}`, {
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const first = await Promise.race([
        reader.read().then(({ value }) => new TextDecoder().decode(value)),
        new Promise<string>((resolve) => setTimeout(() => resolve("(nothing)"), 500)),
      ]);
      controller.abort();
      // An SSE comment: clients ignore it, proxies see data flowing.
      expect(first.startsWith(":")).toBe(true);
    });
  });

  it("fetchCupleSSE asks for an event stream and bypasses the HTTP cache", async () => {
    const cs = await createClientAndServer((builder) => ({
      echo: builder.getSSE(async function* ({ req }) {
        yield { accept: req.headers.accept, cacheControl: req.headers["cache-control"] };
      }),
    }));
    await cs.run(async (client) => {
      const stream = await fetchCupleSSE(client.echo.get).thenKeepSuccess();
      const events: unknown[] = [];
      for await (const event of stream) events.push(event);
      // Without these, a browser can hold a second tab's identical request
      // behind the first one's, until the first stream sends something.
      expect(events[0]).toEqual({
        accept: "text/event-stream",
        cacheControl: "no-cache",
      });
    });
  });
});
