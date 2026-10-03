import { Boundary, useGet } from "@cuple/react";
import { success } from "@cuple/server";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

const calls = counter();
let hold: Promise<void> = Promise.resolve();
const { client, close } = await serve((builder) => ({
  search: builder.querySchema(z.object({ q: z.string() })).get(async ({ data }) => {
    calls.hit(data.query.q);
    calls.hit("search");
    await hold;
    return success({ q: data.query.q });
  }),
}));
afterAll(close);
beforeEach(() => {
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function Results({ q }: { q: string }) {
  const found = useGet(
    client.search.get,
    { query: { q } },
    { config: { loading: { debounceMs: 50 } } },
  );
  return <p>{`results for ${found.q}`}</p>;
}

function Search() {
  const [q, setQ] = useState("a");
  return (
    <>
      <input aria-label="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <Boundary fallback={<p>loading</p>}>
        <Results q={q} />
      </Boundary>
    </>
  );
}

async function type(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("search"), { target: { value: text } });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("loading.debounceMs", () => {
  it("fetches the first args at once, then only what was typed last", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const before = calls.of("search");
    await type("ab");
    await type("abc");
    await type("abcd");
    expect(await screen.findByText("results for abcd")).toBeDefined();
    expect(calls.of("search") - before).toBe(1);
  });

  it("keeps the old results on screen while waiting, and while the new ones load", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    const before = calls.of("search");
    await type("ab");
    await act(() => wait(100));
    expect(calls.of("search") - before).toBe(1);
    expect(screen.getByText("results for a")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
    held.open();
    expect(await screen.findByText("results for ab")).toBeDefined();
  });

  it("going back to the shown args while the new ones load shows the shown args", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    await type("ab");
    await act(() => wait(100));
    await type("a");
    await act(() => wait(100));
    held.open();
    await act(() => wait(50));
    expect(screen.getByText("results for a")).toBeDefined();
  });

  it("going back to the shown args before the wait is over fetches nothing", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const before = calls.of("search");
    await type("ab");
    await type("a");
    await act(() => wait(100));
    expect(calls.of("search")).toBe(before);
  });
});

describe("aborting first loads nobody waits for", () => {
  /** The signal of every search request, by query. */
  function watchRequests() {
    const signals = new Map<string, AbortSignal>();
    const fetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const data = new URL(String(input)).searchParams.get("data");
      const q = data && JSON.parse(data).query?.q;
      if (q && init?.signal) signals.set(q, init.signal);
      return fetch(input, init);
    });
    return signals;
  }

  it("aborts the request for args the user typed past", async () => {
    const signals = watchRequests();
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    await type("ab");
    await act(() => wait(100));
    await type("abc");
    await act(() => wait(100));
    expect(signals.get("ab")?.aborted).toBe(true);
    expect(signals.get("abc")?.aborted).toBe(false);
    held.open();
    expect(await screen.findByText("results for abc")).toBeDefined();
  });

  it("aborts the request when its component unmounts", async () => {
    const signals = watchRequests();
    const { wrapper } = setup();
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            close
          </button>
          {open && <Search />}
        </>
      );
    }
    await renderAsync(<Toggle />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    await type("ab");
    await act(() => wait(100));
    await act(async () => screen.getByText("close").click());
    await act(() => wait(10));
    expect(signals.get("ab")?.aborted).toBe(true);
    held.open();
  });

  it("doesn't abort what another component still waits for", async () => {
    const signals = watchRequests();
    const { wrapper } = setup();
    function Both() {
      const [q, setQ] = useState("a");
      return (
        <>
          <input aria-label="search" value={q} onChange={(e) => setQ(e.target.value)} />
          <Boundary fallback={<p>loading</p>}>
            <Results q={q} />
          </Boundary>
          {q !== "a" && (
            <Boundary fallback={<p>loading pinned</p>}>
              <Results q="ab" />
            </Boundary>
          )}
        </>
      );
    }
    await renderAsync(<Both />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    await type("ab");
    await act(() => wait(100));
    await type("abc");
    await act(() => wait(100));
    expect(signals.get("ab")?.aborted).toBe(false);
    held.open();
    expect(await screen.findByText("results for ab")).toBeDefined();
  });

  it("doesn't abort a preload", async () => {
    const signals = watchRequests();
    const { store, wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    void store.preload(client.search.get, { query: { q: "ab" } });
    await type("ab");
    await act(() => wait(100));
    await type("abc");
    await act(() => wait(100));
    expect(signals.get("ab")?.aborted).toBe(false);
    held.open();
    expect(await screen.findByText("results for abc")).toBeDefined();
  });
});
