import { Boundary, combine, useGet } from "@cuple/react";
import { success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import { useState, useTransition } from "react";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

// "Load more", the recipe from the docs: a pure combined read walks `count`
// pages; the component holds `count`.

const calls = counter();
let notes: string[] = [];
let hold: Promise<void> = Promise.resolve();
const PAGE = 2;
const { client, close } = await serve((builder) => ({
  getNotes: builder
    .querySchema(z.object({ cursor: z.coerce.number().optional() }))
    .get(async ({ data }) => {
      calls.hit("getNotes");
      await hold;
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
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const notePages = combine(async (ctx, args: { count: number }) => {
  const pages = [];
  let cursor: number | null | undefined;
  while (cursor !== null && pages.length < args.count) {
    const page = await ctx.get(client.getNotes, { query: { cursor } });
    pages.push(page);
    cursor = page.nextCursor;
  }
  return { items: pages.flatMap((page) => page.notes), hasMore: cursor !== null };
});

function useNotes() {
  const [count, setCount] = useState(1);
  const [isPending, startTransition] = useTransition();
  const list = useGet(notePages, { count });
  return {
    ...list,
    isPending,
    loadMore: () => startTransition(() => setCount(count + 1)),
  };
}

let list!: ReturnType<typeof useNotes>;
function Notes() {
  list = useNotes();
  return <p>{list.items.join("")}</p>;
}

async function renderNotes() {
  const view = setup();
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Notes />
    </Boundary>,
    { wrapper: view.wrapper },
  );
  expect(await screen.findByText("ab")).toBeDefined();
  return view;
}

it("loads the first page, then one more per click until there are no more", async () => {
  await renderNotes();
  expect(list.hasMore).toBe(true);
  await act(async () => list.loadMore());
  expect(await screen.findByText("abcd")).toBeDefined();
  await act(async () => list.loadMore());
  expect(await screen.findByText("abcde")).toBeDefined();
  expect(list.hasMore).toBe(false);
});

it("load more fetches only the new page", async () => {
  await renderNotes();
  const before = calls.of("getNotes");
  await act(async () => list.loadMore());
  expect(await screen.findByText("abcd")).toBeDefined();
  expect(calls.of("getNotes") - before).toBe(1);
});

it("keeps the loaded pages on screen while the next one loads", async () => {
  await renderNotes();
  const held = gate();
  hold = held.opened;
  await act(async () => list.loadMore());
  expect(screen.getByText("ab")).toBeDefined();
  expect(screen.queryByText("loading")).toBeNull();
  expect(list.isPending).toBe(true);
  held.open();
  expect(await screen.findByText("abcd")).toBeDefined();
  expect(list.isPending).toBe(false);
});

it("refresh re-reads every loaded page, following changed cursors", async () => {
  const { store } = await renderNotes();
  await act(async () => list.loadMore());
  expect(await screen.findByText("abcd")).toBeDefined();
  notes = ["a", "c", "d", "e"]; // "b" deleted: page two's content shifts
  await act(() => store.refresh([client.getNotes]));
  expect(await screen.findByText("acde")).toBeDefined();
});

it("a double click on load more loads one page, not two", async () => {
  await renderNotes();
  const { loadMore } = list;
  await act(async () => {
    loadMore();
    loadMore();
  });
  expect(await screen.findByText("abcd")).toBeDefined();
  expect(list.items).toHaveLength(4);
});
