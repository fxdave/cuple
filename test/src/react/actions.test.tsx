import {
  CupleTransportError,
  CupleUnexpectedResponseError,
  fetchCuple,
} from "@cuple/client";
import {
  type ActionState,
  Boundary,
  type CupleConfig,
  useAction,
  useGet,
} from "@cuple/react";
import { apiResponse, success } from "@cuple/server";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

const calls = counter();
const orders = new Map<number, string>([[1, "Desk"]]);
let hold: Promise<void> = Promise.resolve();
let holdRead: Promise<void> = Promise.resolve();
const { client, offline, close } = await serve((builder) => ({
  getOrder: builder.paramsSchema(z.object({ id: z.number() })).get(async ({ data }) => {
    calls.hit("getOrder");
    const title = orders.get(data.params.id);
    await holdRead;
    return title === undefined
      ? apiResponse("not-found-error", 404, { message: "no such order" })
      : success({ order: { id: data.params.id, title } });
  }),
  getStats: builder.get(async () => {
    calls.hit("getStats");
    return success({ count: orders.size });
  }),
  deleteOrder: builder
    .paramsSchema(z.object({ id: z.number() }))
    .delete(async ({ data }) => {
      orders.delete(data.params.id);
      return success({});
    }),
  renameOrder: builder
    .paramsSchema(z.object({ id: z.number() }))
    .bodySchema(z.object({ title: z.string().min(1, "Title is required") }))
    .patch(async ({ data }) => {
      await hold;
      if (data.body.title === "taken")
        return apiResponse("conflict-error", 409, { message: "edited by someone else" });
      if (data.body.title === "forbidden")
        return apiResponse("forbidden-error", 403, { message: "not yours" });
      orders.set(data.params.id, data.body.title);
      return success({ title: data.body.title });
    }),
}));
afterAll(close);
beforeEach(() => {
  orders.set(1, "Desk");
  hold = Promise.resolve();
  holdRead = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function useRename(id: number) {
  return useAction((title: string) =>
    fetchCuple(client.renameOrder.patch, {
      params: { id },
      body: { title },
    }).thenResolveAlso(["invalid-body", "conflict-error"]),
  );
}

describe("useAction", () => {
  it("starts idle: nothing has happened yet", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    expect(result.current.status).toBe("idle");
    expect(result.current.isPending).toBe(false);
    expect(result.current.value).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it("is pending while the function runs, then done with its value", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    const held = gate();
    hold = held.opened;
    let running!: Promise<ActionState<unknown>>;
    await act(async () => {
      running = result.current.run("Chair");
    });
    expect(result.current.status).toBe("pending");
    expect(result.current.isPending).toBe(true);
    held.open();
    await act(() => running);
    expect(result.current.status).toBe("done");
    expect(result.current.value).toMatchObject({ result: "success", title: "Chair" });
  });

  it("run resolves with the same state the component sees", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    const state = await act(() => result.current.run("Chair"));
    expect(state.status).toBe("done");
    expect(state.value).toMatchObject({ result: "success" });
  });

  it("listed failures are done, with the failure as the value", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    await act(() => result.current.run(""));
    expect(result.current.status).toBe("done");
    const value = result.current.value;
    expect(value?.result).toBe("invalid-body");
    if (value?.result === "invalid-body")
      expect(value.issues[0]).toMatchObject({
        path: ["title"],
        message: "Title is required",
      });
  });

  it("latest run wins: an earlier run finishing later doesn't change the state", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    const first = gate();
    hold = first.opened;
    let slow!: Promise<unknown>;
    await act(async () => {
      slow = result.current.run("Slow");
    });
    hold = Promise.resolve();
    await act(() => result.current.run("taken"));
    expect(result.current.value?.result).toBe("conflict-error");
    first.open();
    await act(() => slow);
    expect(result.current.value?.result).toBe("conflict-error");
  });

  it("reset goes back to idle", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useRename(1), { wrapper });
    await act(() => result.current.run("Chair"));
    await act(async () => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.value).toBeUndefined();
  });
});

describe("useAction errors: handled = listed, unhandled = <Boundary>", () => {
  function Saver(props: { config?: CupleConfig; fn?: () => Promise<unknown> }) {
    const rename = useAction(
      async (title: string) =>
        props.fn
          ? props.fn()
          : fetchCuple(client.renameOrder.patch, {
              params: { id: 1 },
              body: { title },
            }).thenResolveAlso(["invalid-body", "transport-error"]),
      { config: props.config },
    );
    return (
      <>
        <button type="button" onClick={() => rename.run("forbidden")}>
          save
        </button>
        <button type="button" onClick={() => rename.run("")}>
          save empty
        </button>
        <p>{`status: ${rename.status}`}</p>
        {rename.status === "failed" && <p>{`failed: ${rename.error.message}`}</p>}
      </>
    );
  }

  async function renderSaver(props: Parameters<typeof Saver>[0], provider?: CupleConfig) {
    const { wrapper } = setup(provider);
    await renderAsync(
      <Boundary error={(error) => <p>{`boundary: ${error.kind} ${error.message}`}</p>}>
        <Saver {...props} />
      </Boundary>,
      { wrapper },
    );
  }

  async function click(label: string) {
    await act(async () => screen.getByText(label).click());
  }

  it("a listed failure is a value: no boundary, status done", async () => {
    await renderSaver({});
    await click("save empty");
    expect(await screen.findByText("status: done")).toBeDefined();
    expect(screen.queryByText(/boundary:/)).toBeNull();
  });

  it("an unlisted result reaches the boundary as a CupleError with the server's message", async () => {
    await renderSaver({});
    await click("save");
    expect(await screen.findByText("boundary: response not yours")).toBeDefined();
  });

  it("the fallback message is used when there's nothing readable, and cascades", async () => {
    const { wrapper } = setup({ errors: { fallbackMessage: "Something went wrong." } });
    await renderAsync(
      <Boundary
        config={{ errors: { fallbackMessage: "Couldn't save." } }}
        error={(error) => <p>{`boundary: ${error.kind} ${error.message}`}</p>}
      >
        <Saver fn={() => fetchCuple(offline.getStats.get)} />
      </Boundary>,
      { wrapper },
    );
    await click("save");
    expect(await screen.findByText("boundary: transport Couldn't save.")).toBeDefined();
  });

  it("a bug shows its own message in development, the fallback in production", async () => {
    await renderSaver({
      fn: async () => {
        throw new Error("oops, a bug");
      },
    });
    await click("save");
    expect(await screen.findByText("boundary: bug oops, a bug")).toBeDefined();
    cleanup();
    vi.stubEnv("NODE_ENV", "production");
    try {
      await renderSaver({
        fn: async () => {
          throw new Error("oops, a bug");
        },
      });
      await click("save");
      expect(
        await screen.findByText("boundary: bug Something went wrong."),
      ).toBeDefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('onError: "notify" shows it with errors.notify; the page stays, status failed', async () => {
    const notify = vi.fn();
    await renderSaver({}, { errors: { notify, onError: "notify" } });
    await click("save");
    expect(await screen.findByText("failed: not yours")).toBeDefined();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "response",
        message: "not yours",
        statusCode: 403,
      }),
    );
    expect(screen.queryByText(/boundary:/)).toBeNull();
  });

  it("onError can choose per error: e.g. network failures notify, the rest goes to the boundary", async () => {
    const notify = vi.fn();
    const { wrapper } = setup({
      errors: {
        notify,
        onError: (error) => (error.kind === "transport" ? "notify" : "boundary"),
      },
    });
    const { result } = renderHook(
      () => useAction(() => fetchCuple(offline.getStats.get)),
      { wrapper },
    );
    await act(() => result.current.run());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "transport" }));
    expect(result.current.status).toBe("failed");
  });

  it("onError: null keeps it on the action: no boundary, no notification, status failed", async () => {
    const notify = vi.fn();
    await renderSaver({ config: { errors: { onError: null } } }, { errors: { notify } });
    await click("save");
    expect(await screen.findByText("failed: not yours")).toBeDefined();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByText(/boundary:/)).toBeNull();
  });

  it("onError can return null for the errors it handled itself", async () => {
    const handled = vi.fn();
    const notify = vi.fn();
    await renderSaver(
      {
        config: {
          errors: {
            onError: (error) => {
              if (error.statusCode !== 403) return "boundary";
              handled(error.message);
              return null;
            },
          },
        },
      },
      { errors: { notify } },
    );
    await click("save");
    expect(await screen.findByText("failed: not yours")).toBeDefined();
    expect(handled).toHaveBeenCalledWith("not yours");
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByText(/boundary:/)).toBeNull();
  });

  it("a listed transport-error is a value, never a notification", async () => {
    const notify = vi.fn();
    const { wrapper } = setup({ errors: { notify, onError: "notify" } });
    const { result } = renderHook(
      () =>
        useAction(() =>
          fetchCuple(offline.getStats.get).thenResolveAlso(["transport-error"]),
        ),
      { wrapper },
    );
    await act(() => result.current.run());
    expect(result.current.status).toBe("done");
    expect(result.current.value?.result).toBe("transport-error");
    expect(notify).not.toHaveBeenCalled();
  });

  it('"notify" without errors.notify says what\'s missing, at the boundary', async () => {
    await renderSaver({ config: { errors: { onError: "notify" } } });
    await click("save");
    expect(await screen.findByText(/boundary: bug .*notify/)).toBeDefined();
  });

  it("run resolves with the failed state even when the error went to a boundary", async () => {
    const { wrapper } = setup();
    let state: ActionState<unknown> | undefined;
    function Runner() {
      const rename = useRename(1);
      return (
        <button
          type="button"
          onClick={async () => (state = await rename.run("forbidden"))}
        >
          save
        </button>
      );
    }
    await renderAsync(
      <Boundary error={(error) => <p>{`boundary: ${error.message}`}</p>}>
        <Runner />
      </Boundary>,
      { wrapper },
    );
    await click("save");
    expect(await screen.findByText("boundary: not yours")).toBeDefined();
    await waitFor(() => expect(state?.status).toBe("failed"));
  });

  it("an error thrown after the component unmounted is still reported, not lost", async () => {
    const { wrapper } = setup();
    const held = gate();
    hold = held.opened;
    let running!: Promise<unknown>;
    function Runner() {
      const rename = useRename(1);
      return (
        <button type="button" onClick={() => (running = rename.run("forbidden"))}>
          save
        </button>
      );
    }
    const view = await renderAsync(
      <Boundary error={() => <p>boundary</p>}>
        <Runner />
      </Boundary>,
      { wrapper },
    );
    await click("save");
    view.unmount();
    held.open();
    await running;
    expect(console.error).toHaveBeenCalledWith(expect.any(CupleUnexpectedResponseError));
  });
});

describe('reads with <Boundary error="notify">', () => {
  it("notifies and renders nothing in the region; the rest of the page stays", async () => {
    const notify = vi.fn();
    const { wrapper } = setup({ errors: { notify } });
    function Missing() {
      useGet(client.getOrder.get, { params: { id: 999 } });
      return <p>order</p>;
    }
    await renderAsync(
      <>
        <p>page</p>
        <Boundary fallback={<p>loading</p>} error="notify">
          <Missing />
        </Boundary>
      </>,
      { wrapper },
    );
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "response", message: "no such order" }),
      ),
    );
    expect(screen.getByText("page")).toBeDefined();
    expect(screen.queryByText("order")).toBeNull();
    expect(screen.queryByText("loading")).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("useAction refresh", () => {
  function OrderAndStats({ id }: { id: number }) {
    const { order } = useGet(client.getOrder.get, { params: { id } });
    const { count } = useGet(client.getStats.get);
    return <p>{`${order.title} / ${count}`}</p>;
  }

  it("refreshes nothing unless the action names it", async () => {
    const { wrapper } = setup();
    let rename!: ReturnType<typeof useRename>;
    function Screen() {
      rename = useRename(1);
      return (
        <Boundary fallback={<p>loading</p>}>
          <OrderAndStats id={1} />
        </Boundary>
      );
    }
    await renderAsync(<Screen />, { wrapper });
    expect(await screen.findByText("Desk / 1")).toBeDefined();
    const before = { order: calls.of("getOrder"), stats: calls.of("getStats") };
    await act(() => rename.run("Chair"));
    expect(calls.of("getOrder")).toBe(before.order);
    expect(calls.of("getStats")).toBe(before.stats);
    expect(screen.getByText("Desk / 1")).toBeDefined();
  });

  it("refreshes exactly the named endpoints, and is pending until they're fresh", async () => {
    const { wrapper } = setup();
    let rename!: { run: (title: string) => Promise<ActionState<unknown>> };
    function Screen() {
      rename = useAction(
        (title: string) =>
          fetchCuple(client.renameOrder.patch, {
            params: { id: 1 },
            body: { title },
          }),
        { refresh: [client.getOrder.get] },
      );
      return (
        <Boundary fallback={<p>loading</p>}>
          <OrderAndStats id={1} />
        </Boundary>
      );
    }
    await renderAsync(<Screen />, { wrapper });
    expect(await screen.findByText("Desk / 1")).toBeDefined();
    const stats = calls.of("getStats");
    const state = await act(() => rename.run("Chair"));
    expect(state.status).toBe("done");
    // Already fresh when run resolves, not one render later.
    expect(screen.getByText("Chair / 1")).toBeDefined();
    expect(calls.of("getStats")).toBe(stats);
  });

  it("a list refreshes whenever the function finishes: no guessing from the value", async () => {
    const { wrapper } = setup();
    let rename!: { run: (title: string) => Promise<unknown> };
    function Screen() {
      rename = useAction(
        (title: string) =>
          fetchCuple(client.renameOrder.patch, {
            params: { id: 1 },
            body: { title },
          }).thenResolveAlso(["invalid-body"]),
        { refresh: [client.getOrder.get] },
      );
      return (
        <Boundary fallback={<p>loading</p>}>
          <OrderAndStats id={1} />
        </Boundary>
      );
    }
    await renderAsync(<Screen />, { wrapper });
    expect(await screen.findByText("Desk / 1")).toBeDefined();
    const before = calls.of("getOrder");
    await act(() => rename.run(""));
    expect(calls.of("getOrder")).toBe(before + 1);
  });

  it("a map by result refreshes only for the listed results", async () => {
    const { wrapper } = setup();
    let rename!: { run: (title: string) => Promise<unknown> };
    function Screen() {
      rename = useAction(
        (title: string) =>
          fetchCuple(client.renameOrder.patch, {
            params: { id: 1 },
            body: { title },
          }).thenResolveAlso(["invalid-body"]),
        { refresh: { success: [client.getOrder.get] } },
      );
      return (
        <Boundary fallback={<p>loading</p>}>
          <OrderAndStats id={1} />
        </Boundary>
      );
    }
    await renderAsync(<Screen />, { wrapper });
    expect(await screen.findByText("Desk / 1")).toBeDefined();
    const before = calls.of("getOrder");
    await act(() => rename.run(""));
    expect(calls.of("getOrder")).toBe(before);
    await act(() => rename.run("Chair"));
    expect(screen.getByText("Chair / 1")).toBeDefined();
  });

  it("keeps the old content on screen while refreshing: no fallback", async () => {
    const { wrapper } = setup();
    let rename!: { run: (title: string) => Promise<unknown> };
    function Screen() {
      rename = useAction(
        (title: string) =>
          fetchCuple(client.renameOrder.patch, {
            params: { id: 1 },
            body: { title },
          }),
        { refresh: [client.getOrder.get, client.getStats.get] },
      );
      return (
        <Boundary fallback={<p>loading</p>}>
          <OrderAndStats id={1} />
        </Boundary>
      );
    }
    await renderAsync(<Screen />, { wrapper });
    expect(await screen.findByText("Desk / 1")).toBeDefined();
    const before = calls.of("getOrder");
    const read = gate();
    holdRead = read.opened;
    const running = rename.run("Chair");
    // The write landed and the refetch is on its way, held at the server.
    await waitFor(() => expect(calls.of("getOrder")).toBe(before + 1));
    expect(screen.queryByText("loading")).toBeNull();
    expect(screen.getByText("Desk / 1")).toBeDefined();
    read.open();
    await act(() => running);
    expect(screen.getByText("Chair / 1")).toBeDefined();
  });
});

describe("refresh types", () => {
  it("only accepts results the function can return as keys", () => {
    const { wrapper } = setup();
    renderHook(
      () =>
        useAction(
          () =>
            fetchCuple(client.renameOrder.patch, {
              params: { id: 1 },
              body: { title: "x" },
            }).thenResolveAlso(["invalid-body"]),
          // @ts-expect-error "conflict-error" is not listed, so it can't be returned
          { refresh: { "conflict-error": [client.getOrder.get] } },
        ),
      { wrapper },
    );
  });
});

describe("deleting the item a pane shows", () => {
  it("closes the pane inside the action: the refresh never 404s it", async () => {
    const { wrapper } = setup();
    function Pane({ id, onClose }: { id: number; onClose: () => void }) {
      const { order } = useGet(client.getOrder.get, { params: { id } });
      const remove = useAction(
        async () => {
          await fetchCuple(client.deleteOrder.delete, { params: { id } });
          onClose();
        },
        { refresh: [client.getOrder.get, client.getStats.get] },
      );
      return (
        <button type="button" onClick={() => remove.run()}>
          {`delete ${order.title}`}
        </button>
      );
    }
    function Screen() {
      const [open, setOpen] = useState(true);
      const { count } = useGet(client.getStats.get);
      return (
        <>
          <p>{`${count} orders`}</p>
          <Boundary fallback={<p>loading</p>} error={() => <p>crashed</p>}>
            {open ? <Pane id={1} onClose={() => setOpen(false)} /> : <p>closed</p>}
          </Boundary>
        </>
      );
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Screen />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("delete Desk")).toBeDefined();
    expect(screen.getByText("1 orders")).toBeDefined();
    await act(async () => screen.getByText("delete Desk").click());
    expect(await screen.findByText("0 orders")).toBeDefined();
    expect(screen.getByText("closed")).toBeDefined();
    expect(screen.queryByText("crashed")).toBeNull();
  });
});
