import { Boundary, combine, useGet, useIsFetching } from "@cuple/react";
import { apiResponse, success } from "@cuple/server";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

const calls = counter();
const titles = new Map<number, string>();
let hold: Promise<void> = Promise.resolve();
let failStats = false;
const { client, close } = await serve((builder) => ({
  getOrder: builder.paramsSchema(z.object({ id: z.number() })).get(async ({ data }) => {
    calls.hit("getOrder");
    // Read before waiting: a held response carries the data from when it started.
    const title = titles.get(data.params.id);
    await hold;
    return title === undefined
      ? apiResponse("not-found-error", 404, { message: "no such order" })
      : success({ order: { id: data.params.id, title } });
  }),
  getStats: builder.get(async () => {
    calls.hit("getStats");
    if (failStats) return apiResponse("unexpected-error", 500, { message: "boom" });
    return success({ count: titles.size, nested: { fixed: true } });
  }),
}));
afterAll(close);
beforeEach(() => {
  titles.clear();
  titles.set(1, "Desk");
  titles.set(2, "Lamp");
  hold = Promise.resolve();
  failStats = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function Order({ id }: { id: number }) {
  const { order } = useGet(client.getOrder.get, { params: { id } });
  return <p>{`order ${order.id}: ${order.title}`}</p>;
}

describe("store.refresh", () => {
  it("refetches mounted entries of the endpoint, keeping old content until the new arrives", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("order 1: Desk")).toBeDefined();
    titles.set(1, "Chair");
    const held = gate();
    hold = held.opened;
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getOrder.get]);
    });
    expect(screen.getByText("order 1: Desk")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
    held.open();
    await act(() => refreshing);
    expect(screen.getByText("order 1: Chair")).toBeDefined();
  });

  it("marks unmounted entries stale instead of fetching them now", async () => {
    const { store, wrapper } = setup();
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            toggle
          </button>
          <Boundary fallback={<p>loading</p>}>{open && <Order id={2} />}</Boundary>
        </>
      );
    }
    await renderAsync(<Toggle />, { wrapper });
    expect(await screen.findByText("order 2: Lamp")).toBeDefined();
    await act(async () => screen.getByText("toggle").click());
    const before = calls.of("getOrder");
    titles.set(2, "Bulb");
    await act(() => store.refresh([client.getOrder.get]));
    expect(calls.of("getOrder")).toBe(before);
    await act(async () => screen.getByText("toggle").click());
    expect(await screen.findByText("order 2: Bulb")).toBeDefined();
  });

  it("an entry nobody reads that was deleted never 404s", async () => {
    const { store, wrapper } = setup();
    function Pane() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            close
          </button>
          <Boundary fallback={<p>loading</p>} error={() => <p>crashed</p>}>
            {open ? <Order id={2} /> : <p>closed</p>}
          </Boundary>
        </>
      );
    }
    await renderAsync(<Pane />, { wrapper });
    expect(await screen.findByText("order 2: Lamp")).toBeDefined();
    await act(async () => screen.getByText("close").click());
    titles.delete(2);
    await act(() => store.refresh([client.getOrder.get]));
    expect(screen.getByText("closed")).toBeDefined();
    expect(screen.queryByText("crashed")).toBeNull();
  });

  it("a request already in flight when refresh is called is fetched again afterwards", async () => {
    const { store, wrapper } = setup();
    const held = gate();
    hold = held.opened;
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    await waitFor(() => expect(calls.of("getOrder")).toBeGreaterThan(0));
    titles.set(1, "Chair"); // server changed after the first request started
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getOrder.get]);
    });
    hold = Promise.resolve();
    held.open();
    await act(() => refreshing);
    expect(await screen.findByText("order 1: Chair")).toBeDefined();
  });

  it("keeps object identity when the refreshed data is equal", async () => {
    const { store, wrapper } = setup();
    const seen: unknown[] = [];
    function Stats() {
      const stats = useGet(client.getStats.get);
      seen.push(stats.nested);
      return <p>{`count ${stats.count}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 2")).toBeDefined();
    await act(() => store.refresh([client.getStats.get]));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(1);
  });

  it("an API failure on refresh throws where the data is read", async () => {
    const { store, wrapper } = setup();
    function Stats() {
      const { count } = useGet(client.getStats.get);
      return <p>{`count ${count}`}</p>;
    }
    await renderAsync(
      <Boundary
        fallback={<p>loading</p>}
        error={(error) => <p>{`error: ${error.message}`}</p>}
      >
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 2")).toBeDefined();
    failStats = true;
    await act(() => store.refresh([client.getStats.get]));
    expect(await screen.findByText("error: boom")).toBeDefined();
  });

  it("re-runs combined read that fetched a refreshed endpoint through get", async () => {
    const { store, wrapper } = setup();
    const loadTitle = combine(async ({ get }, id: number) => {
      const { order } = await get(client.getOrder.get, { params: { id } });
      return order.title.toUpperCase();
    });
    function Title() {
      return <p>{useGet(loadTitle, 1)}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Title />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("DESK")).toBeDefined();
    titles.set(1, "Chair");
    await act(() => store.refresh([client.getOrder.get]));
    expect(await screen.findByText("CHAIR")).toBeDefined();
  });
});

describe("store.preload", () => {
  it("fetches before render, so the read doesn't fetch again", async () => {
    const { store, wrapper } = setup();
    const before = calls.of("getOrder");
    await store.preload(client.getOrder.get, { params: { id: 1 } });
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    expect(screen.getByText("order 1: Desk")).toBeDefined();
    expect(calls.of("getOrder") - before).toBe(1);
  });

  it("never rejects, and a failed preload is not shown to a later reader", async () => {
    const { store, wrapper } = setup();
    titles.delete(1);
    await expect(
      store.preload(client.getOrder.get, { params: { id: 1 } }),
    ).resolves.toBeUndefined();
    titles.set(1, "Desk");
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={() => <p>crashed</p>}>
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("order 1: Desk")).toBeDefined();
  });
});

describe("store.clear", () => {
  it("drops everything; readers fetch again", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("order 1: Desk")).toBeDefined();
    titles.set(1, "Chair");
    await act(async () => store.clear());
    expect(await screen.findByText("order 1: Chair")).toBeDefined();
  });
});

describe("Boundary", () => {
  it("retry drops the failed entries and renders again", async () => {
    const { wrapper } = setup();
    titles.delete(1);
    await renderAsync(
      <Boundary
        fallback={<p>loading</p>}
        error={(_error, retry) => (
          <button type="button" onClick={retry}>
            retry
          </button>
        )}
      >
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    const retry = await screen.findByText("retry");
    titles.set(1, "Desk");
    await act(async () => retry.click());
    expect(await screen.findByText("order 1: Desk")).toBeDefined();
  });

  it("without an error prop it passes the error to the parent boundary", async () => {
    const { wrapper } = setup();
    titles.delete(1);
    await renderAsync(
      <Boundary error={() => <p>outer</p>}>
        <Boundary fallback={<p>loading</p>}>
          <Order id={1} />
        </Boundary>
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("outer")).toBeDefined();
  });
});

describe("polling", () => {
  it("everyMs refetches while mounted", async () => {
    const { wrapper } = setup();
    function Stats() {
      const { count } = useGet(client.getStats.get, undefined, {
        config: { loading: { everyMs: 30 } },
      });
      return <p>{`count ${count}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 2")).toBeDefined();
    titles.set(3, "Rug");
    expect(await screen.findByText("count 3")).toBeDefined();
  });
});

describe("useIsFetching", () => {
  function Probe() {
    return <p>{useIsFetching() ? "busy" : "idle"}</p>;
  }

  it("is true while a refresh someone asked for is in flight", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Probe />
        <Order id={1} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("order 1: Desk")).toBeDefined();
    expect(screen.getByText("idle")).toBeDefined();
    const held = gate();
    hold = held.opened;
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getOrder.get]);
    });
    expect(screen.getByText("busy")).toBeDefined();
    held.open();
    await act(() => refreshing);
    expect(screen.getByText("idle")).toBeDefined();
  });

  it("ignores a preload: nobody is waiting for it yet", async () => {
    const { store, wrapper } = setup();
    const { result } = renderHook(() => useIsFetching(), { wrapper });
    const held = gate();
    hold = held.opened;
    let loading!: Promise<void>;
    await act(async () => {
      loading = store.preload(client.getOrder.get, { params: { id: 1 } });
    });
    expect(result.current).toBe(false);
    held.open();
    await act(() => loading);
  });

  it("ignores polling: a bar blinking every interval is noise", async () => {
    const { wrapper } = setup();
    const seen: boolean[] = [];
    function Stats() {
      seen.push(useIsFetching());
      const { count } = useGet(client.getStats.get, undefined, {
        config: { loading: { everyMs: 20 } },
      });
      return <p>{`count ${count}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Stats />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("count 2")).toBeDefined();
    seen.length = 0;
    const before = calls.of("getStats");
    await waitFor(() => expect(calls.of("getStats")).toBeGreaterThan(before + 1));
    expect(seen.every((busy) => !busy)).toBe(true);
  });
});
