import { fetchCuple } from "@cuple/client";
import {
  Boundary,
  CupleProvider,
  createCupleStore,
  useAction,
  useGet,
  useIsFetching,
} from "@cuple/react";
import { success } from "@cuple/server";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

const calls = counter();
let count = 1;
let hold: Promise<void> = Promise.resolve();
let holdStats: Promise<void> = Promise.resolve();
const { client, network, close } = await serve((builder) => ({
  getStats: builder.get(async () => {
    calls.hit("getStats");
    const current = count;
    await holdStats;
    return success({ count: current });
  }),
  getOrder: builder
    .paramsSchema(z.object({ id: z.union([z.number(), z.string()]) }))
    .get(async ({ data }) => success({ id: String(data.params.id) })),
  bump: builder.post(async () => {
    await hold;
    count++;
    return success({});
  }),
}));
afterAll(close);
beforeEach(() => {
  count = 1;
  hold = Promise.resolve();
  holdStats = Promise.resolve();
  network.down = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function Stats(props: { everyMs?: number }) {
  const { count } = useGet(client.getStats.get, undefined, {
    config: { loading: { everyMs: props.everyMs } },
  });
  return <p>{`count ${count}`}</p>;
}

describe("transport failures during a refresh", () => {
  it("keep the old data on screen instead of throwing", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={() => <p>crashed</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    network.down = true;
    await act(() => store.refresh([client.getStats.get]));
    expect(screen.getByText("count 1")).toBeDefined();
    expect(screen.queryByText("crashed")).toBeNull();
  });

  it("only then listen for the browser coming online: a store alone adds no listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    createCupleStore();
    expect(add).not.toHaveBeenCalledWith("online", expect.anything());
    add.mockRestore();
  });

  it("are retried when the browser comes back online", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    network.down = true;
    count = 2;
    await act(() => store.refresh([client.getStats.get]));
    network.down = false;
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(await screen.findByText("count 2")).toBeDefined();
  });
});

describe("store.clear", () => {
  it("removes the old data from the screen at once: it may belong to another account", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    const refetch = gate();
    holdStats = refetch.opened;
    count = 2;
    // Outside `act`: an awaited `act` would wait for the refetch.
    store.clear();
    expect(await screen.findByText("loading")).toBeDefined();
    // React keeps suspended content in the DOM, hidden, to preserve its state.
    const old = screen.queryByText("count 1");
    expect(old === null || old.style.display === "none").toBe(true);
    refetch.open();
    expect(await screen.findByText("count 2")).toBeDefined();
  });
});

describe("garbage collection", () => {
  it("drops an entry nobody reads after gcTime, so the next read fetches", async () => {
    const { wrapper } = setup({ cache: { storeStaleMs: 20 } });
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            toggle
          </button>
          <Boundary fallback={<p>loading</p>}>{open && <Stats />}</Boundary>
        </>
      );
    }
    await renderAsync(<Toggle />, { wrapper });
    expect(await screen.findByText("count 1")).toBeDefined();
    await act(async () => screen.getByText("toggle").click());
    const before = calls.of("getStats");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await act(async () => screen.getByText("toggle").click());
    expect(await screen.findByText("count 1")).toBeDefined();
    expect(calls.of("getStats")).toBe(before + 1);
  });

  it("keeps an entry while someone reads it", async () => {
    const { wrapper } = setup({ cache: { storeStaleMs: 20 } });
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    const before = calls.of("getStats");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls.of("getStats")).toBe(before);
    expect(screen.getByText("count 1")).toBeDefined();
  });
});

describe("polling", () => {
  it("stops when the reader unmounts", async () => {
    const { wrapper } = setup();
    const view = await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats everyMs={20} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    view.unmount();
    const after = calls.of("getStats");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls.of("getStats")).toBe(after);
  });
});

describe("useIsFetching", () => {
  it("counts a running action", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        busy: useIsFetching(),
        bump: useAction(() => fetchCuple(client.bump.post)),
      }),
      { wrapper },
    );
    const held = gate();
    hold = held.opened;
    let running!: Promise<unknown>;
    act(() => {
      running = result.current.bump.run();
    });
    expect(result.current.busy).toBe(true);
    held.open();
    await act(() => running);
    expect(result.current.busy).toBe(false);
  });
});

describe("cache keys", () => {
  it("clients made with different with({ key }) never share entries", async () => {
    const { wrapper } = setup();
    const alice = client.with({ key: "alice" });
    const bob = client.with({ key: "bob" });
    const before = calls.of("getStats");
    function Both() {
      useGet(alice.getStats.get);
      useGet(bob.getStats.get);
      return <p>both</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Both />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("both")).toBeDefined();
    expect(calls.of("getStats") - before).toBe(2);
  });

  it("warns when a read misses only because a number arrived as a string", async () => {
    const { store, wrapper } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.preload(client.getOrder.get, { params: { id: "5" } });
    function Order() {
      const { id } = useGet(client.getOrder.get, { params: { id: 5 } });
      return <p>{`order ${id}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("order 5")).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"5"'));
  });
});

describe("near-miss warning", () => {
  it("stays quiet for args that really differ", async () => {
    const { store } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.preload(client.getOrder.get, { params: { id: "5" } });
    await store.preload(client.getOrder.get, { params: { id: 6 } });
    await store.preload(client.getOrder.get, { params: { id: "7" } });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("CupleProvider", () => {
  it("is required, and says so", () => {
    function Stray() {
      useGet(client.getStats.get);
      return null;
    }
    expect(() => render(<Stray />)).toThrow(/wrap your app in <CupleProvider/);
  });

  it("rejects a store not made by createCupleStore, and says so", () => {
    const fake = {
      refresh: async () => {},
      preload: async () => {},
      clear: () => {},
      refreshKeys: () => {},
    };
    expect(() =>
      render(
        <CupleProvider store={fake}>
          <p>app</p>
        </CupleProvider>,
      ),
    ).toThrow(/createCupleStore/);
  });

  it("each store is its own cache", async () => {
    const before = calls.of("getStats");
    for (const store of [createCupleStore(), createCupleStore()]) {
      await renderAsync(
        <CupleProvider store={store}>
          <Boundary fallback={<p>loading</p>}>
            <Stats />
          </Boundary>
        </CupleProvider>,
      );
      await waitFor(() =>
        expect(screen.getAllByText("count 1").length).toBeGreaterThan(0),
      );
    }
    expect(calls.of("getStats") - before).toBe(2);
  });
});
