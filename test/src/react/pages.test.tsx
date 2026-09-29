import { Boundary, usePages } from "@cuple/react";
import { success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { renderAsync, serve, setup } from "./serve";

let notes: string[] = [];
const PAGE = 2;
const { client, close } = await serve((builder) => ({
  getNotes: builder
    .querySchema(z.object({ cursor: z.coerce.number().optional() }))
    .get(async ({ data }) => {
      const start = data.query.cursor ?? 0;
      const end = start + PAGE;
      return success({
        notes: notes.slice(start, end),
        nextCursor: end < notes.length ? end : null,
      });
    }),
}));
afterAll(close);
beforeEach(() => {
  notes = ["a", "b", "c", "d", "e"];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

let list!: ReturnType<typeof useNotes>;
function useNotes() {
  return usePages(client.getNotes.get, { query: {} }, (last) =>
    last.nextCursor === null ? null : { query: { cursor: last.nextCursor } },
  );
}
function Notes() {
  list = useNotes();
  return <p>{list.pages.flatMap((page) => page.notes).join("")}</p>;
}

it("loads the first page, then more until next returns null", async () => {
  const { wrapper } = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  expect(list.hasMore).toBe(true);
  await act(() => list.loadMore());
  expect(screen.getByText("abcd")).toBeDefined();
  await act(() => list.loadMore());
  expect(screen.getByText("abcde")).toBeDefined();
  expect(list.hasMore).toBe(false);
});

it("keeps the loaded pages on screen while the next one loads", async () => {
  const { wrapper } = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  let loading!: Promise<void>;
  await act(async () => {
    loading = list.loadMore();
  });
  expect(screen.queryByText("loading")).toBeNull();
  expect(list.isPending).toBe(true);
  await act(() => loading);
  expect(list.isPending).toBe(false);
});

it("refresh re-reads every loaded page, following changed cursors", async () => {
  const { store, wrapper } = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  await act(() => list.loadMore());
  expect(screen.getByText("abcd")).toBeDefined();
  notes = ["a", "c", "d", "e"]; // "b" deleted: page two's content shifts
  await act(() => store.refresh([client.getNotes.get]));
  expect(await screen.findByText("acde")).toBeDefined();
});

it("a double click on load more loads one page, not two", async () => {
  const { wrapper } = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  const { loadMore } = list;
  await act(() => Promise.all([loadMore(), loadMore()]));
  expect(screen.getByText("abcd")).toBeDefined();
  expect(list.pages).toHaveLength(2);
});

it("loadMore keeps its identity across renders", async () => {
  const { wrapper } = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  const before = list.loadMore;
  await act(() => list.loadMore());
  expect(list.loadMore).toBe(before);
});
