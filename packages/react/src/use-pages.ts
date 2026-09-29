import { startTransition, useCallback, useRef, useState } from "react";
import { type CupleConfig, useConfig } from "./config";
import { useCupleContext } from "./provider";
import type { GetEndpoint, ReadableArgs, ReadValue, Route } from "./types";
import { readThrough, useSubscription } from "./use-get";

/**
 * A list loaded page by page, for "load more" and infinite scroll.
 *
 * ```tsx
 * const notes = usePages(client.getNotes.get, { query: {} }, (last) =>
 *   last.nextCursor === null ? null : { query: { cursor: last.nextCursor } },
 * );
 * notes.pages.flatMap((page) => page.notes);
 * <button onClick={notes.loadMore} disabled={!notes.hasMore || notes.isPending}>More</button>
 * ```
 *
 * Every page is an ordinary cached call, so a refresh of the endpoint refetches
 * the loaded pages — each with its current args, and following a cursor that
 * changed (an item was deleted, so page two now starts elsewhere).
 *
 * Suspends for the first page only. `loadMore` keeps the loaded pages on screen
 * and sets `isPending` until the next one lands. Pages are success only; a
 * failed page throws to the nearest `<Boundary>`.
 */
export function usePages<R extends GetEndpoint | Route>(
  endpoint: R,
  first: ReadableArgs<R>,
  next: (last: ReadValue<R>) => ReadableArgs<R> | null,
  options?: { config?: CupleConfig },
) {
  const { store } = useCupleContext();
  const config = useConfig(options?.config);
  const [count, setCount] = useState(1);
  const [isPending, setIsPending] = useState(false);

  // The pages known so far, to subscribe to before anything suspends.
  const keys: string[] = [];
  let args: ReadableArgs<R> | null = first;
  for (let i = 0; i < count && args !== null; i++) {
    const key = store.keyOf(endpoint, args);
    keys.push(key);
    const cached = store.peek(key);
    const page = cached?.value as ReadValue<R> | undefined;
    // Only a cached success leads to the next page's args; anything else is read below.
    if ((page as { result?: string } | undefined)?.result !== "success") break;
    args = next(page as ReadValue<R>);
  }
  useSubscription(store, keys, config);

  // Every hook comes before the first `use()` below: when a read suspends on
  // the first render, React replays the component, and a hook after it breaks.
  // Read through a ref, so `loadMore` keeps its identity: the client proxy
  // builds a new endpoint object on every access.
  const latest = useRef({ endpoint, next, pages: [] as ReadValue<R>[] });
  const loading = useRef<Promise<void> | null>(null);

  /**
   * Loads the next page, keeping the loaded ones on screen. Resolves when it's
   * shown. A call while one is running joins it: a double click loads one page.
   */
  const loadMore = useCallback((): Promise<void> => {
    if (loading.current) return loading.current;
    const { endpoint, pages, next } = latest.current;
    const last = pages[pages.length - 1];
    const nextArgs = last === undefined ? null : next(last);
    if (nextArgs === null) return Promise.resolve();
    const target = pages.length + 1;
    setIsPending(true);
    loading.current = store.preload(endpoint, ...([nextArgs] as never)).then(() => {
      loading.current = null;
      startTransition(() => {
        setCount((count) => Math.max(count, target));
        setIsPending(false);
      });
    });
    return loading.current;
  }, [store]);

  const pages: ReadValue<R>[] = [];
  args = first;
  for (let i = 0; i < count && args !== null; i++) {
    const page = readThrough(store, endpoint, args) as ReadValue<R>;
    pages.push(page);
    args = next(page);
  }
  const hasMore = args !== null && pages.length === count;
  latest.current = { endpoint, next, pages };

  return { pages, hasMore, isPending, loadMore };
}
