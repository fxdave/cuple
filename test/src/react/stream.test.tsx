import { CupleTransportError } from "@cuple/client";
import { Boundary, useStream } from "@cuple/react";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { renderAsync, serve, setup } from "./serve";

const { client, offline, close } = await serve((builder) => ({
  feed: builder.getSSE(async function* () {
    yield { n: 1 };
    yield { n: 2 };
  }),
  forever: builder.getSSE(async function* ({ disconnectSignal }) {
    yield { n: 1 };
    await new Promise((resolve) => disconnectSignal.addEventListener("abort", resolve));
  }),
  denied: builder
    .middleware(async () => ({
      next: false,
      statusCode: 401,
      result: "unauthorized" as const,
      message: "Sign in first",
    }))
    .getSSE(async function* () {
      yield { n: 1 };
    }),
}));
afterAll(close);
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

it("hands over every event, then stops streaming", async () => {
  const { wrapper } = setup();
  const events: unknown[] = [];
  const { result } = renderHook(
    () => useStream(client.feed.get, {}, (event) => events.push(event)),
    { wrapper },
  );
  expect(result.current.isStreaming).toBe(true);
  await waitFor(() => expect(result.current.isStreaming).toBe(false));
  expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  expect(result.current.error).toBeUndefined();
});

it("types the events from the server definition", () => {
  const { wrapper } = setup();
  renderHook(
    () =>
      useStream(client.feed.get, {}, (event) => {
        const n: number = event.n;
        // @ts-expect-error events have no other fields
        void event.other;
        void n;
      }),
    { wrapper },
  );
});

it("closes the stream on unmount without an error", async () => {
  const { wrapper } = setup();
  const events: unknown[] = [];
  const { result, unmount } = renderHook(
    () => useStream(client.forever.get, {}, (event) => events.push(event)),
    { wrapper },
  );
  await waitFor(() => expect(events).toHaveLength(1));
  unmount();
  expect(result.current.error).toBeUndefined();
});

it("throws a rejected connection (an API result) to the nearest boundary", async () => {
  const { wrapper } = setup();
  function Feed() {
    useStream(client.denied.get, {}, () => {});
    return <p>streaming</p>;
  }
  await renderAsync(
    <Boundary error={(error) => <p>{`boundary: ${error.message}`}</p>}>
      <Feed />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("boundary: Sign in first")).toBeDefined();
});

it("keeps a network failure as state: streams drop, and the page should stay", async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => useStream(offline.feed.get, {}, () => {}), {
    wrapper,
  });
  await waitFor(() => expect(result.current.error).toBeInstanceOf(CupleTransportError));
  expect(result.current.isStreaming).toBe(false);
});

it("reconnect opens the stream again", async () => {
  const { wrapper } = setup();
  const events: unknown[] = [];
  const { result } = renderHook(
    () => useStream(client.feed.get, {}, (event) => events.push(event)),
    { wrapper },
  );
  await waitFor(() => expect(result.current.isStreaming).toBe(false));
  await act(async () => result.current.reconnect());
  await waitFor(() => expect(events).toHaveLength(4));
});
