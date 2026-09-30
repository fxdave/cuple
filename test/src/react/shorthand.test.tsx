import { fetchCuple } from "@cuple/client";
import { Boundary, combine, useAction, useGet, usePages } from "@cuple/react";
import { apiResponse, success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, renderAsync, serve, setup } from "./serve";

/**
 * `client.getOrder` means `client.getOrder.get` wherever something is read.
 * The long form keeps working, and both are the same cached call.
 */
const calls = counter();
let title = "Desk";
const { client, close } = await serve((builder) => ({
  getOrder: builder.paramsSchema(z.object({ id: z.number() })).get(async ({ data }) => {
    calls.hit("getOrder");
    return data.params.id === 404
      ? apiResponse("not-found-error", 404, { message: "gone" })
      : success({ order: { id: data.params.id, title } });
  }),
  getNotes: builder
    .querySchema(z.object({ page: z.coerce.number() }))
    .get(async ({ data }) =>
      success({ page: data.query.page, notes: [`n${data.query.page}`] }),
    ),
  rename: builder.post(async () => {
    calls.hit("rename");
    title = "Chair";
    return success({});
  }),
}));
afterAll(close);
beforeEach(() => {
  title = "Desk";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("route shorthand", () => {
  it("useGet reads a route without `.get`, sharing the cache with the long form", async () => {
    const { wrapper } = setup();
    const before = calls.of("getOrder");
    function Both() {
      const short = useGet(client.getOrder, { params: { id: 1 } });
      const long = useGet(client.getOrder.get, { params: { id: 1 } });
      return <p>{`${short.order.title} ${long.order.title}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Both />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("Desk Desk")).toBeDefined();
    expect(calls.of("getOrder") - before).toBe(1);
  });

  it("keeps resolve options and their types", async () => {
    const { wrapper } = setup();
    function Missing() {
      const res = useGet(
        client.getOrder,
        { params: { id: 404 } },
        { resolveAlso: ["not-found-error"] },
      );
      return <p>{res.result === "not-found-error" ? "deleted" : res.order.title}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Missing />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("deleted")).toBeDefined();
  });

  it("refresh lists, store.refresh and preload accept routes", async () => {
    const { store, wrapper } = setup();
    let rename!: () => Promise<unknown>;
    function Order() {
      rename = useAction(() => fetchCuple(client.rename.post), {
        refresh: [client.getOrder],
      }).run;
      return <p>{useGet(client.getOrder, { params: { id: 1 } }).order.title}</p>;
    }
    await store.preload(client.getOrder, { params: { id: 1 } });
    const afterPreload = calls.of("getOrder");
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order />
      </Boundary>,
      { wrapper },
    );
    expect(screen.getByText("Desk")).toBeDefined();
    expect(calls.of("getOrder")).toBe(afterPreload);
    await act(() => rename());
    expect(screen.getByText("Chair")).toBeDefined();
    title = "Lamp";
    await act(() => store.refresh([client.getOrder]));
    expect(screen.getByText("Lamp")).toBeDefined();
  });

  it("get inside combine and usePages accept routes", async () => {
    const { wrapper } = setup();
    const titled = combine(async ({ get }, id: number) => {
      const { order } = await get(client.getOrder, { params: { id } });
      return order.title.toUpperCase();
    });
    function Page() {
      const upper = useGet(titled, 1);
      const list = usePages(client.getNotes, { query: { page: 0 } }, (last) =>
        last.page < 1 ? { query: { page: last.page + 1 } } : null,
      );
      return <p>{`${upper} ${list.pages.flatMap((p) => p.notes).join(",")}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Page />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("DESK n0")).toBeDefined();
  });
});

describe("reads are GET only", () => {
  it("a non-GET endpoint can't be read, and says why", async () => {
    const { wrapper } = setup();
    const before = calls.of("rename");
    function Writes() {
      // The types refuse it (see below); a cast reaches the runtime check.
      useGet(client.rename.post as never);
      return <p>rendered</p>;
    }
    await renderAsync(
      <Boundary error={(error) => <p>{`boundary: ${error.message}`}</p>}>
        <Writes />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText(/boundary: .*GET.*rename\.post/)).toBeDefined();
    // Refused before anything was sent.
    expect(calls.of("rename")).toBe(before);
  });

  it("types: reads, refresh lists and usePages accept GET only; args of no-input pages may be undefined", () => {
    // @ts-expect-error a POST endpoint is a write, not a read
    const read = () => useGet(client.rename.post);
    // @ts-expect-error nor can it be refreshed
    const refresh = () => useAction(async () => {}, { refresh: [client.rename.post] });
    const pages = () => usePages(client.getNotes, { query: { page: 0 } }, () => null);
    void [read, refresh, pages];
  });

  it("types: the map form of refresh needs a function that returns Cuple results", () => {
    const list = () =>
      useAction(async () => "https://example.com/file.png", {
        refresh: [client.getOrder],
      });
    const map = () =>
      useAction(async () => "https://example.com/file.png", {
        // @ts-expect-error a string has no `result`: this map could never match
        refresh: { success: [client.getOrder] },
      });
    void [list, map];
  });
});

describe("route shorthand types", () => {
  it("are the same as the long form's", () => {
    type Read<T> = T extends (...args: never[]) => infer R ? R : never;
    const short = () => useGet(client.getOrder, { params: { id: 1 } });
    const long = () => useGet(client.getOrder.get, { params: { id: 1 } });
    const same: Read<typeof short> = null as unknown as Read<typeof long>;
    void same;
    // @ts-expect-error the route still needs its params
    const missing = () => useGet(client.getOrder);
    // @ts-expect-error a route without GET can't be read
    const notReadable = () => useGet(client.rename);
    void [missing, notReadable];
  });
});
