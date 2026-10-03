import { Boundary, useGet } from "@cuple/react";
import { success } from "@cuple/server";
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, gate, renderAsync, serve, setup } from "./serve";

const calls = counter();
let hold: Promise<void> = Promise.resolve();
const { client, close } = await serve((builder) => ({
  search: builder.querySchema(z.object({ q: z.string() })).get(async ({ data }) => {
    calls.hit(data.query.q);
    calls.hit("search");
    await hold;
    return success({ q: data.query.q });
  }),
}));
afterAll(close);
beforeEach(() => {
  hold = Promise.resolve();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function Results({ q }: { q: string }) {
  const found = useGet(
    client.search.get,
    { query: { q } },
    { config: { loading: { debounceMs: 50 } } },
  );
  return <p>{`results for ${found.q}`}</p>;
}

function Search() {
  const [q, setQ] = useState("a");
  return (
    <>
      <input aria-label="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <Boundary fallback={<p>loading</p>}>
        <Results q={q} />
      </Boundary>
    </>
  );
}

async function type(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("search"), { target: { value: text } });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("loading.debounceMs", () => {
  it("fetches the first args at once, then only what was typed last", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const before = calls.of("search");
    await type("ab");
    await type("abc");
    await type("abcd");
    expect(await screen.findByText("results for abcd")).toBeDefined();
    expect(calls.of("search") - before).toBe(1);
  });

  it("keeps the old results on screen while waiting, and while the new ones load", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const held = gate();
    hold = held.opened;
    const before = calls.of("search");
    await type("ab");
    await act(() => wait(100));
    expect(calls.of("search") - before).toBe(1);
    expect(screen.getByText("results for a")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
    held.open();
    expect(await screen.findByText("results for ab")).toBeDefined();
  });

  it("going back to the shown args before the wait is over fetches nothing", async () => {
    const { wrapper } = setup();
    await renderAsync(<Search />, { wrapper });
    expect(await screen.findByText("results for a")).toBeDefined();
    const before = calls.of("search");
    await type("ab");
    await type("a");
    await act(() => wait(100));
    expect(calls.of("search")).toBe(before);
  });
});
