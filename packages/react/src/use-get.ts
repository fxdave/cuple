import { CupleTransportError, transportErrorResult } from "@cuple/client";
import { startTransition, use, useEffect, useReducer, useRef } from "react";
import { type ResolvedConfig, useConfig } from "./config";
import { useCupleContext } from "./provider";
import { listsTransportError, resolveResult, retentionOf, type Store } from "./store";
import type { Readable, ReadOptions, ReadRest, ReadValue, ResolveOptions } from "./types";

/**
 * Reads an endpoint or a {@link combine} through the cache.
 *
 * ```tsx
 * const { products } = useGet(client.getProducts.get);
 * const order = useGet(client.getOrder.get, { params: { id } }, { resolveAlso: ["not-found-error"] });
 * ```
 *
 * - GET only: a read runs on every render, refresh and poll, so a write
 *   endpoint is refused. For a POST that only reads, use `combine`.
 * - Suspends until the first load lands, and again when the args change: the
 *   old data belongs to other args, and showing it under the new ones could
 *   lead to a write against the wrong item. To keep old content while new
 *   args load (search boxes), pass `useDeferredValue(args)`.
 * - Success only by default: anything else throws to the nearest `<Boundary>`.
 *   `resolveAlso` keeps the listed results as values; `resolveOn` keeps only
 *   the listed ones.
 * - Every reader of the same call shares one request and one cached result.
 * - A refresh keeps the current data on screen until the new data lands.
 * - Coming back to cached data (another tab, a reopened panel) shows it at once
 *   and refreshes it in the background, unless it's younger than
 *   `config.cache.freshMs`.
 *
 * To fetch only sometimes, render the component only sometimes:
 * `{id && <Order id={id} />}`. There is no `enabled` flag.
 */
export function useGet<
  R extends Readable,
  const O extends ReadOptions<R> = ReadOptions<R>,
>(readable: R, ...rest: ReadRest<R, O>): ReadValue<R, O> {
  const { store } = useCupleContext();
  const [args, options] = rest as unknown as [unknown, ReadOptions<Readable> | undefined];
  const config = useConfig(options?.config);
  const key = store.keyOf(readable, args);
  useSubscription(store, [key], config);
  return readThrough(store, readable, args, config, options) as ReadValue<R, O>;
}

/** Reads one call during render: the value, or suspends, or throws. Loop-safe. */
export function readThrough(
  store: Store,
  readable: Readable,
  args: unknown,
  config: ResolvedConfig,
  options?: ResolveOptions<Readable>,
): unknown {
  const entry = store.ensure(readable, args, "foreground", retentionOf(config.cache));
  try {
    const outcome = store.read(entry);
    if ("pending" in outcome) use(outcome.pending);
  } catch (error) {
    // A network failure the reader listed is a value, like any listed result.
    // (Anything else rethrows — including React's own suspense signal.)
    if (listsTransportError(options) && error instanceof CupleTransportError)
      return transportErrorResult(error);
    throw error;
  }
  try {
    return resolveResult(entry, options);
  } catch (error) {
    store.markThrew(entry);
    throw error;
  }
}

/**
 * Re-renders when any of the calls change. Updates arrive as transitions, so a
 * refresh that makes a child suspend keeps the current screen instead of
 * showing a fallback. Call it before reading, so it sees what was cached.
 */
export function useSubscription(store: Store, keys: string[], config: ResolvedConfig) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const seen = useRef<number[]>([]);
  seen.current = keys.map((key) => store.versionOf(key));
  // Data someone already read before is "coming back to it" (another tab, a
  // reopened panel). Data only this render loaded — even if it landed while
  // this render was suspended — is a first load, and must not be fetched
  // twice. Taken during render, so StrictMode's second effect run agrees.
  const returning = useRef<boolean[]>([]);
  returning.current = keys.map((key) => store.wasRead(key));
  const latest = useRef(config);
  latest.current = config;
  const joined = keys.join("\n");
  const { everyMs, blocking } = config.loading;
  const { freshMs, storeStaleMs } = retentionOf(config.cache);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `joined` stands for `keys`
  useEffect(() => {
    const update = (change = { urgent: false }) =>
      change.urgent ? rerender() : startTransition(rerender);
    const unsubscribe = keys.map((key) =>
      store.subscribe(key, update, {
        everyMs,
        blocking,
        retention: { freshMs, storeStaleMs },
      }),
    );
    // Something landed between render and subscribe.
    if (keys.some((key, i) => store.versionOf(key) !== seen.current[i])) update();
    keys.forEach((key, i) => {
      if (returning.current[i]) store.refreshIfStale(key, latest.current.cache);
    });
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [store, joined, everyMs, blocking, freshMs, storeStaleMs]);
}
