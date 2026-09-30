import {
  Boundary,
  CupleProvider,
  combine,
  createCupleStore,
  useGet,
  useStream,
} from "@cuple/react";
import { success } from "@cuple/server";
import { act, screen, waitFor } from "@testing-library/react";
import { memo, type ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve } from "./serve";

/**
 * `store.refreshKeys()`: every cached call checks whether its key is still its
 * key. Unchanged ones stay; changed ones are read again under the new key.
 */
const calls = counter();
let hold: Promise<void> = Promise.resolve();
const { client: base, close } = await serve((builder) => {
  const authed = builder.headersSchema(z.looseObject({ authorization: z.string() }));
  return {
    whoami: authed.get(async ({ data }) => {
      calls.hit(`whoami:${data.headers.authorization}`);
      await hold;
      return success({ user: data.headers.authorization });
    }),
    feed: authed.getSSE(async function* ({ data, disconnectSignal }) {
      yield { user: data.headers.authorization };
      await new Promise((resolve) => disconnectSignal.addEventListener("abort", resolve));
    }),
  };
});
afterAll(close);

let current = "ada";
const client = base.with({
  key: () => current,
  middleware: () => ({ headers: { authorization: current } }),
});

beforeEach(() => {
  current = "ada";
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

type Config = Parameters<typeof CupleProvider>[0]["config"];

/** Memoized: a state change above it would not re-render it. */
const WhoAmI = memo(function WhoAmI() {
  const { user } = useGet(client.whoami);
  return <p>{`user ${user}`}</p>;
});

async function renderWhoAmI(config?: Config) {
  // Background refresh on read is off here, so request counts show only what refreshKeys does.
  const store = createCupleStore();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <CupleProvider
        store={store}
        config={{ ...config, cache: { refreshOnRead: "never", ...config?.cache } }}
      >
        {children}
      </CupleProvider>
    );
  }
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <WhoAmI />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("user ada")).toBeDefined();
  return { store, wrapper };
}

describe("store.refreshKeys", () => {
  it("leaves calls whose key didn't change alone: no request", async () => {
    const { store } = await renderWhoAmI();
    const before = calls.of("whoami:ada");
    await act(async () => store.refreshKeys());
    expect(screen.getByText("user ada")).toBeDefined();
    expect(calls.of("whoami:ada")).toBe(before);
  });

  it("re-reads a changed key, even in a memoized component", async () => {
    const { store } = await renderWhoAmI();
    current = "linus";
    await act(async () => store.refreshKeys());
    expect(await screen.findByText("user linus")).toBeDefined();
  });

  it('onKeyChange "drop" (default): the old key\'s data is gone, switching back loads again', async () => {
    const { store } = await renderWhoAmI();
    current = "linus";
    await act(async () => store.refreshKeys());
    expect(await screen.findByText("user linus")).toBeDefined();
    const before = calls.of("whoami:ada");
    current = "ada";
    await act(async () => store.refreshKeys());
    expect(await screen.findByText("user ada")).toBeDefined();
    expect(calls.of("whoami:ada")).toBe(before + 1);
  });

  it('onKeyChange "keep": switching back uses the cache', async () => {
    const { store } = await renderWhoAmI({ cache: { onKeyChange: "keep" } });
    current = "linus";
    await act(async () => store.refreshKeys());
    expect(await screen.findByText("user linus")).toBeDefined();
    const before = calls.of("whoami:ada");
    current = "ada";
    await act(async () => store.refreshKeys());
    expect(screen.getByText("user ada")).toBeDefined();
    expect(calls.of("whoami:ada")).toBe(before);
  });

  it("never refetches an entry under a key that is no longer current", async () => {
    const { store } = await renderWhoAmI({ cache: { onKeyChange: "keep" } });
    const held = gate();
    hold = held.opened;
    // A refresh is in flight for ada, and a second one is queued behind it.
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.whoami]);
      void store.refresh([client.whoami]);
    });
    const adaBefore = calls.of("whoami:ada");
    const linusBefore = calls.of("whoami:linus");
    current = "linus";
    hold = Promise.resolve();
    await act(async () => store.refreshKeys());
    held.open();
    await act(() => refreshing);
    expect(await screen.findByText("user linus")).toBeDefined();
    // The queued refetch of ada's entry didn't go out as linus.
    expect(calls.of("whoami:linus")).toBe(linusBefore + 1);
    expect(calls.of("whoami:ada")).toBe(adaBefore);
    // And ada's kept data is still ada's.
    current = "ada";
    await act(async () => store.refreshKeys());
    expect(screen.getByText("user ada")).toBeDefined();
  });

  it("re-runs a combined read when a call it read changed its key", async () => {
    const { store, wrapper } = await renderWhoAmI();
    const shouting = combine(async ({ get }) => {
      const { user } = await get(client.whoami);
      return user.toUpperCase();
    });
    function Shout() {
      return <p>{`shout ${useGet(shouting)}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Shout />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("shout ADA")).toBeDefined();
    current = "linus";
    await act(async () => store.refreshKeys());
    expect(await screen.findByText("shout LINUS")).toBeDefined();
  });

  it("reconnects a stream whose key changed", async () => {
    const { store, wrapper } = await renderWhoAmI();
    const seen: string[] = [];
    function Feed() {
      useStream(client.feed.get, {}, (event) => seen.push(event.user));
      return null;
    }
    await renderAsync(<Feed />, { wrapper });
    await waitFor(() => expect(seen).toEqual(["ada"]));
    current = "linus";
    await act(async () => store.refreshKeys());
    await waitFor(() => expect(seen).toEqual(["ada", "linus"]));
  });
});
