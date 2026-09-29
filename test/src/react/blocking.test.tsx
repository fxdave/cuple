import { fetchCuple } from "@cuple/client";
import { Boundary, useAction, useGet, useIsFetching } from "@cuple/react";
import { success } from "@cuple/server";
import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gate, renderAsync, serve, setup } from "./serve";

let hold: Promise<void> = Promise.resolve();
const { client, close } = await serve((builder) => ({
  getPortfolio: builder.get(async () => {
    await hold;
    return success({ name: "Main" });
  }),
  getStats: builder.get(async () => {
    await hold;
    return success({ count: 1 });
  }),
  moveProperty: builder.post(async () => {
    await hold;
    return success({});
  }),
}));
afterAll(close);
beforeEach(() => {
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** What a full-page overlay would read. */
function Overlay() {
  return <p>{useIsFetching({ blocking: true }) ? "overlay: on" : "overlay: off"}</p>;
}
function Progress() {
  return <p>{useIsFetching() ? "progress: on" : "progress: off"}</p>;
}

describe("blocking actions", () => {
  it("a blocking action shows the overlay while it runs, including its refresh", async () => {
    const { wrapper } = setup();
    let run!: () => Promise<unknown>;
    function Mover() {
      run = useAction(() => fetchCuple(client.moveProperty.post).thenUnwrap(), {
        config: { loading: { blocking: true } },
      }).run;
      return null;
    }
    await renderAsync(
      <>
        <Overlay />
        <Mover />
      </>,
      { wrapper },
    );
    expect(screen.getByText("overlay: off")).toBeDefined();
    const held = gate();
    hold = held.opened;
    let running!: Promise<unknown>;
    act(() => {
      running = run();
    });
    expect(screen.getByText("overlay: on")).toBeDefined();
    held.open();
    await act(() => running);
    expect(screen.getByText("overlay: off")).toBeDefined();
  });

  it("an ordinary action never shows it, but still counts as fetching", async () => {
    const { wrapper } = setup();
    let run!: () => Promise<unknown>;
    function Saver() {
      run = useAction(() => fetchCuple(client.moveProperty.post).thenUnwrap()).run;
      return null;
    }
    await renderAsync(
      <>
        <Overlay />
        <Progress />
        <Saver />
      </>,
      { wrapper },
    );
    const held = gate();
    hold = held.opened;
    let running!: Promise<unknown>;
    act(() => {
      running = run();
    });
    expect(screen.getByText("overlay: off")).toBeDefined();
    expect(screen.getByText("progress: on")).toBeDefined();
    held.open();
    await act(() => running);
  });
});

describe("blocking reads", () => {
  function Portfolio({ blocking }: { blocking: boolean }) {
    const { name } = useGet(client.getPortfolio.get, undefined, {
      config: { loading: { blocking } },
    });
    return <p>{`portfolio ${name}`}</p>;
  }

  it("a blocking read shows the overlay while its data refetches", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <>
        <Overlay />
        <Boundary fallback={<p>loading</p>}>
          <Portfolio blocking />
        </Boundary>
      </>,
      { wrapper },
    );
    expect(await screen.findByText("portfolio Main")).toBeDefined();
    expect(screen.getByText("overlay: off")).toBeDefined();
    const held = gate();
    hold = held.opened;
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getPortfolio.get]);
    });
    expect(screen.getByText("overlay: on")).toBeDefined();
    held.open();
    await act(() => refreshing);
    expect(screen.getByText("overlay: off")).toBeDefined();
  });

  it("the same refetch without blocking readers doesn't show it", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <>
        <Overlay />
        <Boundary fallback={<p>loading</p>}>
          <Portfolio blocking={false} />
        </Boundary>
      </>,
      { wrapper },
    );
    expect(await screen.findByText("portfolio Main")).toBeDefined();
    const held = gate();
    hold = held.opened;
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = store.refresh([client.getPortfolio.get]);
    });
    expect(screen.getByText("overlay: off")).toBeDefined();
    held.open();
    await act(() => refreshing);
  });

  it("stops blocking when the blocking reader unmounts mid-refetch", async () => {
    const { store, wrapper } = setup();
    let hide!: () => void;
    function Page() {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return (
        <Boundary fallback={<p>loading</p>}>{shown && <Portfolio blocking />}</Boundary>
      );
    }
    await renderAsync(
      <>
        <Overlay />
        <Page />
      </>,
      { wrapper },
    );
    expect(await screen.findByText("portfolio Main")).toBeDefined();
    const held = gate();
    hold = held.opened;
    await act(async () => {
      void store.refresh([client.getPortfolio.get]);
    });
    expect(screen.getByText("overlay: on")).toBeDefined();
    await act(async () => hide());
    expect(screen.getByText("overlay: off")).toBeDefined();
    held.open();
  });
});

describe("blocking refresh", () => {
  it("store.refresh(targets, { blocking: true }) shows the overlay until it lands", async () => {
    const { store, wrapper } = setup();
    await renderAsync(
      <>
        <Overlay />
        <Boundary fallback={<p>loading</p>}>
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
      refreshing = store.refresh([client.getStats.get], { blocking: true });
    });
    expect(screen.getByText("overlay: on")).toBeDefined();
    held.open();
    await act(() => refreshing);
    await waitFor(() => expect(screen.getByText("overlay: off")).toBeDefined());
  });
});

function Stats() {
  const { count } = useGet(client.getStats.get);
  return <p>{`count ${count}`}</p>;
}
