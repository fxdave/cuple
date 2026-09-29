import { fetchCuple } from "@cuple/client";
import {
  Boundary,
  CupleProvider,
  createCupleStore,
  useAction,
  useGet,
  useIsFetching,
} from "@cuple/react";
import { apiResponse, success } from "@cuple/server";
import { act, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { counter, gate, renderAsync, serve } from "./serve";

const calls = counter();
let count = 1;
let hold: Promise<void> = Promise.resolve();
const { client, close } = await serve((builder) => ({
  getStats: builder.get(async () => {
    calls.hit("getStats");
    const current = count;
    await hold;
    return success({ count: current });
  }),
  forbidden: builder.post(async () =>
    apiResponse("forbidden-error", 403, { message: "no" }),
  ),
}));
afterAll(close);
beforeEach(() => {
  count = 1;
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

type Config = Parameters<typeof CupleProvider>[0]["config"];

function provider(config?: Config) {
  const store = createCupleStore();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <CupleProvider store={store} config={config}>
        {children}
      </CupleProvider>
    );
  }
  return { store, wrapper };
}

function Stats({ config }: { config?: Config }) {
  const { count } = useGet(client.getStats, undefined, { config });
  return <p>{`count ${count}`}</p>;
}

/** Shows or hides its children, like switching an in-app tab away and back. */
let toggleTab!: () => Promise<void>;
function Tab({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  toggleTab = async () => {
    await act(async () => setShown((s) => !s));
  };
  return (
    <Boundary fallback={<p>loading</p>}>{shown ? children : <p>other tab</p>}</Boundary>
  );
}

describe("config cascades: request > Boundary > Provider > built-in", () => {
  function Failing({ config }: { config?: Config }) {
    const action = useAction(() => fetchCuple(client.forbidden.post).thenUnwrap(), {
      config,
    });
    return (
      <>
        <button type="button" onClick={() => action.run()}>
          go
        </button>
        <p>{`status ${action.status}`}</p>
      </>
    );
  }
  async function click() {
    await act(async () => screen.getByText("go").click());
  }

  it("the provider's errors apply to actions inside it", async () => {
    const notify = vi.fn();
    const { wrapper } = provider({ errors: { unhandled: "notify", notify } });
    await renderAsync(<Failing />, { wrapper });
    await click();
    expect(await screen.findByText("status failed")).toBeDefined();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a Boundary's config overrides the provider's for what's inside it", async () => {
    const notify = vi.fn();
    const regional = vi.fn();
    const { wrapper } = provider({ errors: { unhandled: "notify", notify } });
    await renderAsync(
      <Boundary config={{ errors: { notify: regional } }}>
        <Failing />
      </Boundary>,
      { wrapper },
    );
    await click();
    expect(await screen.findByText("status failed")).toBeDefined();
    expect(regional).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("a request's config overrides both, one setting at a time", async () => {
    const notify = vi.fn();
    const { wrapper } = provider({ errors: { notify } });
    await renderAsync(
      <Boundary config={{ errors: { message: "Region message." } }}>
        <Failing config={{ errors: { unhandled: "notify" } }} />
      </Boundary>,
      { wrapper },
    );
    await click();
    expect(await screen.findByText("status failed")).toBeDefined();
    // `notify` comes from the provider, `unhandled` from the request.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("loading settings from a Boundary apply to reads inside it", async () => {
    const { store, wrapper } = provider();
    function Overlay() {
      return <p>{useIsFetching({ blocking: true }) ? "overlay on" : "overlay off"}</p>;
    }
    await renderAsync(
      <>
        <Overlay />
        <Boundary fallback={<p>loading</p>} config={{ loading: { blocking: true } }}>
          <Stats />
        </Boundary>
      </>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    const held = gate();
    hold = held.opened;
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getStats]);
    });
    expect(screen.getByText("overlay on")).toBeDefined();
    held.open();
    await act(() => refreshing);
  });
});

describe("cache.refreshOnRead: coming back to cached data", () => {
  it("default: shows the cached data at once, and refreshes it in the background", async () => {
    const { wrapper } = provider();
    await renderAsync(
      <Tab>
        <Stats />
      </Tab>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await toggleTab();
    count = 2;
    const held = gate();
    hold = held.opened;
    const before = calls.of("getStats");
    await toggleTab();
    // Instant: the cached value, no fallback.
    expect(screen.getByText("count 1")).toBeDefined();
    expect(calls.of("getStats")).toBe(before + 1);
    held.open();
    expect(await screen.findByText("count 2")).toBeDefined();
  });

  it("a first load is not fetched twice", async () => {
    const { wrapper } = provider();
    const before = calls.of("getStats");
    await renderAsync(
      <Tab>
        <Stats />
      </Tab>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.of("getStats") - before).toBe(1);
  });

  it('"never": shows the cache, nothing refetches', async () => {
    const { wrapper } = provider({ cache: { refreshOnRead: "never" } });
    await renderAsync(
      <Tab>
        <Stats />
      </Tab>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await toggleTab();
    const before = calls.of("getStats");
    await toggleTab();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.of("getStats")).toBe(before);
  });

  it("freshFor: data younger than that is not refetched", async () => {
    const { wrapper } = provider({ cache: { freshFor: 60_000 } });
    await renderAsync(
      <Tab>
        <Stats />
      </Tab>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await toggleTab();
    const before = calls.of("getStats");
    await toggleTab();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.of("getStats")).toBe(before);
  });

  it("the background refresh doesn't light the progress bar", async () => {
    const { wrapper } = provider();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useIsFetching());
      return null;
    }
    await renderAsync(
      <>
        <Probe />
        <Tab>
          <Stats />
        </Tab>
      </>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await toggleTab();
    seen.length = 0;
    await toggleTab();
    await waitFor(() => expect(calls.of("getStats")).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.every((busy) => !busy)).toBe(true);
  });
});

describe("cache.keep: how long data nobody reads stays", () => {
  it("keep: 0 drops it when the last reader unmounts", async () => {
    const { wrapper } = provider();
    await renderAsync(
      <Tab>
        <Stats config={{ cache: { keep: 0 } }} />
      </Tab>,
      { wrapper },
    );
    expect(await screen.findByText("count 1")).toBeDefined();
    await toggleTab();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = calls.of("getStats");
    await toggleTab();
    // Gone from the cache: a first load again, not a background refresh of cached data.
    expect(await screen.findByText("count 1")).toBeDefined();
    expect(calls.of("getStats")).toBe(before + 1);
  });

  it("the longest keep among the readers wins, whatever order they came in", async () => {
    const { wrapper } = provider({ cache: { refreshOnRead: "never" } });
    await renderAsync(
      <Tab>
        {/* keep: 0 subscribes last, so "the last reader's keep" would drop it. */}
        <Stats />
        <Stats config={{ cache: { keep: 0 } }} />
      </Tab>,
      { wrapper },
    );
    await waitFor(() => expect(screen.getAllByText("count 1")).toHaveLength(2));
    await toggleTab();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = calls.of("getStats");
    await toggleTab();
    // The default 5 minutes won over keep: 0: still cached, no request.
    expect(screen.getAllByText("count 1")).toHaveLength(2);
    expect(calls.of("getStats")).toBe(before);
  });
});
