import { Boundary, type CupleConfig, combine, useGet } from "@cuple/react";
import { success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import { startTransition, useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, renderAsync, serve, setup } from "./serve";

const calls = counter();
const { client, close } = await serve((builder) => ({
  getNotes: builder
    .querySchema(z.object({ page: z.coerce.number() }))
    .get(async ({ data }) => {
      calls.hit("getNotes");
      return success({
        notes: [`note ${data.query.page}`],
        hasMore: data.query.page < 9,
      });
    }),
}));
afterAll(close);
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const notePages = combine({
  load: async (ctx, args: { count: number }) => {
    const pages = await Promise.all(
      Array.from({ length: args.count }, (_, page) =>
        ctx.get(client.getNotes, { query: { page } }),
      ),
    );
    return pages.flatMap((page) => page.notes);
  },
});

let loadMore!: () => Promise<void>;
let hide!: () => Promise<void>;
function Notes({ config }: { config?: CupleConfig }) {
  const [count, setCount] = useState(1);
  loadMore = async () => {
    await act(async () => startTransition(() => setCount((c) => c + 1)));
  };
  const notes = useGet(notePages, { count }, { config });
  return <p>{notes.join(", ")}</p>;
}

describe("a combined read owns the calls it makes", () => {
  it("keeps its pieces as long as it is kept: its settings reach them", async () => {
    // Pieces on their own would be dropped 20 ms after they're unread.
    const { wrapper } = setup({ cache: { storeStaleMs: 20 } });
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Notes config={{ cache: { storeStaleMs: Infinity } }} />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("note 0")).toBeDefined();
    await loadMore();
    expect(await screen.findByText("note 0, note 1")).toBeDefined();
    // Long past the pieces' own expiry, and past the grace for unshown data.
    await act(() => wait(1_200));
    const before = calls.of("getNotes");
    await loadMore();
    expect(await screen.findByText("note 0, note 1, note 2")).toBeDefined();
    // Only the new page: pages 0 and 1 were still held by the combined read.
    expect(calls.of("getNotes") - before).toBe(1);
  });

  it("releases its pieces when it is dropped: they follow their own settings again", async () => {
    const { wrapper } = setup({ cache: { storeStaleMs: 20 } });
    function Toggle() {
      const [shown, setShown] = useState(true);
      hide = async () => {
        await act(async () => setShown(false));
      };
      return <Boundary fallback={<p>loading</p>}>{shown && <Notes />}</Boundary>;
    }
    await renderAsync(<Toggle />, { wrapper });
    expect(await screen.findByText("note 0")).toBeDefined();
    await hide();
    await act(() => wait(1_200));
    // The combined read and its piece are both gone: reading the piece fetches it.
    const before = calls.of("getNotes");
    function Page0() {
      return <p>{useGet(client.getNotes, { query: { page: 0 } }).notes[0]}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Page0 />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("note 0")).toBeDefined();
    expect(calls.of("getNotes") - before).toBe(1);
  });
});

describe("cache.maxStoredCalls", () => {
  let show!: (page: number) => Promise<void>;
  function Page({ config }: { config?: CupleConfig }) {
    const [page, setPage] = useState(0);
    show = async (next) => {
      await act(async () => setPage(next));
    };
    return (
      <Boundary fallback={<p>loading</p>}>
        <PageNotes page={page} config={config} />
      </Boundary>
    );
  }
  function PageNotes({ page, config }: { page: number; config?: CupleConfig }) {
    const { notes } = useGet(client.getNotes, { query: { page } }, { config });
    return <p>{notes[0]}</p>;
  }
  /** Shows `page`, and how many requests that took. */
  async function visit(page: number) {
    const before = calls.of("getNotes");
    await show(page);
    expect(await screen.findByText(`note ${page}`)).toBeDefined();
    return calls.of("getNotes") - before;
  }

  it("keeps at most that many unread calls per endpoint, dropping the one unread longest", async () => {
    const { wrapper } = setup({ cache: { freshMs: Infinity, maxStoredCalls: 2 } });
    await renderAsync(<Page />, { wrapper });
    expect(await screen.findByText("note 0")).toBeDefined();
    for (const page of [1, 2, 3]) expect(await visit(page)).toBe(1);
    // Unread now: 0, 1, 2. With room for 2, page 0 (unread longest) was dropped.
    expect(await visit(2)).toBe(0);
    expect(await visit(1)).toBe(0);
    expect(await visit(0)).toBe(1);
  });

  it("defaults to 3", async () => {
    const { wrapper } = setup({ cache: { freshMs: Infinity } });
    await renderAsync(<Page />, { wrapper });
    expect(await screen.findByText("note 0")).toBeDefined();
    for (const page of [1, 2, 3, 4]) expect(await visit(page)).toBe(1);
    // Unread: 0, 1, 2, 3. Page 0 was dropped, 1 to 3 kept.
    expect(await visit(1)).toBe(0);
    expect(await visit(0)).toBe(1);
  });

  it("never drops a call something reads", async () => {
    const { wrapper } = setup({ cache: { freshMs: Infinity, maxStoredCalls: 1 } });
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        {[0, 1, 2, 3].map((page) => (
          <PageNotes key={page} page={page} />
        ))}
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("note 3")).toBeDefined();
    const before = calls.of("getNotes");
    await act(() => wait(1_200));
    expect(screen.getByText("note 0")).toBeDefined();
    expect(calls.of("getNotes")).toBe(before);
  });

  it("doesn't count the calls a cached combined read owns", async () => {
    const { wrapper } = setup({ cache: { freshMs: Infinity } });
    function List({ count }: { count: number }) {
      return <p>{useGet(notePages, { count }).join(", ")}</p>;
    }
    function Toggle() {
      const [shown, setShown] = useState(true);
      hide = async () => {
        await act(async () => setShown((s) => !s));
      };
      return (
        <Boundary fallback={<p>loading</p>}>
          {shown ? <List count={5} /> : <p>hidden</p>}
        </Boundary>
      );
    }
    await renderAsync(<Toggle />, { wrapper });
    const all = "note 0, note 1, note 2, note 3, note 4";
    expect(await screen.findByText(all)).toBeDefined();
    await hide();
    await act(() => wait(1_200));
    const before = calls.of("getNotes");
    await hide();
    // 5 pages, all held by the cached combined read: back at once, no requests.
    expect(screen.getByText(all)).toBeDefined();
    expect(calls.of("getNotes")).toBe(before);
  });
});
