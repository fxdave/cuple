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
