import { createContext, useContext } from "react";
import type { CupleError } from "./errors";

/**
 * Where an error nobody handled goes (a result nobody listed, a network
 * failure nobody listed as `"transport-error"`, a bug):
 * - `"boundary"`: the nearest `<Boundary>` shows it.
 * - `"notify"`: `errors.notify` shows it; the page stays.
 * - `null`: nowhere — it's handled. The action's `status` is `"failed"` and
 *   `error` holds it, for the component to show.
 */
export type ErrorRoute = "boundary" | "notify" | null;

/**
 * One route for every error, or a function choosing per error. The function
 * must return: `null` says "I handled it", so it can't be forgotten.
 */
export type OnError = ErrorRoute | ((error: CupleError) => ErrorRoute);

/**
 * How Cuple behaves, grouped by concern. The same shape is accepted by
 * `<CupleProvider config>`, `<Boundary config>` and each request's
 * `{ config }`. Every setting cascades on its own — request over Boundary over
 * Provider over the built-in default — so setting `cache.freshMs` somewhere
 * never resets `cache.storeStaleMs` from above.
 */
export type CupleConfig = {
  cache?: {
    /**
     * `false`: keep nothing once it's unread — data is dropped as soon as the
     * last reader unmounts, and refetched when read again. Readers mounted at
     * the same time still share one request. The same as `freshMs: 0,
     * storeStaleMs: 0`, for search boxes and other args that keep changing.
     * Default: `true`.
     */
    enabled?: boolean;
    /**
     * How long data counts as fresh after it lands, in ms. A component that
     * starts reading fresh data (switching back to a tab, reopening a panel)
     * gets it from the cache as is; stale data is shown at once too, and
     * refetched in the background. `0` always refetches, `Infinity` never.
     * Fresh data nobody reads is never dropped.
     *
     * Only coming back to data counts: polls, refreshes and actions' `refresh`
     * refetch fresh data too. A first load is never fetched twice. Default: 0.
     *
     * With `Infinity`, data nobody reads stays for good: right for reference
     * data, wrong for args that keep changing (a search), which pile up.
     */
    freshMs?: number;
    /**
     * How long data nobody reads stays in memory once it's stale, in ms: the
     * clock starts when it is both stale and unread, whichever comes last.
     * With several readers, the longest wins. Default: 5 minutes.
     */
    storeStaleMs?: number;
    /**
     * Whether `store.refreshKeys()` keeps data whose key changed (the user a
     * `with({ key })` getter returns, say). `false` deletes it at once, so
     * nothing of the previous account can show again. `true` keeps it like
     * any data nobody reads, so switching back is instant: only when one
     * person owns every account. Read from the provider. Default: `false`.
     */
    keepOnKeyChange?: boolean;
  };
  errors?: {
    /**
     * Actions: where an error nobody handled goes — `"boundary"`, `"notify"`,
     * `null` (handled), or a function choosing per error. Errors you handle are
     * the results you list with `thenResolveAlso` — typed values that never
     * get here. Default: `"boundary"`.
     */
    onError?: OnError;
    /**
     * How the app shows an error without replacing the page: a toast, a
     * banner. Used by `onError: "notify"` and `<Boundary error="notify">`.
     */
    notify?: (error: CupleError) => void;
    /**
     * `error.message` when there's nothing readable to show: a network
     * failure, a server result without a message, a bug in production.
     * Default: `"Something went wrong."`
     */
    fallbackMessage?: string;
  };
  loading?: {
    /**
     * Makes `useIsFetching({ blocking: true })` true: for actions while they
     * run, for reads while their data refetches. For a full-page overlay.
     */
    blocking?: boolean;
    /** Reads only: refetch every this many ms while something reads it. */
    everyMs?: number;
    /**
     * `useGet` only: when its args change, keep showing the current ones until
     * they've stayed the same for this many ms, then load the new ones as a
     * transition — the current data stays on screen meanwhile. One request
     * for a burst of typing, not one per keystroke. The first args load at once.
     *
     * A first load it moved on from (or unmounted during) is aborted, unless
     * another component, a preload or a combined read asked for it too.
     */
    debounceMs?: number;
  };
};

/** Every setting resolved: the built-in defaults, with the cascade applied. */
export type ResolvedConfig = {
  cache: Required<NonNullable<CupleConfig["cache"]>>;
  errors: {
    onError: OnError;
    notify?: (error: CupleError) => void;
    fallbackMessage: string;
  };
  loading: { blocking: boolean; everyMs?: number; debounceMs?: number };
};

export const defaultConfig: ResolvedConfig = {
  cache: { enabled: true, freshMs: 0, storeStaleMs: 5 * 60_000, keepOnKeyChange: false },
  errors: { onError: "boundary", fallbackMessage: "Something went wrong." },
  loading: { blocking: false },
};

/** `over` on top of `base`, one setting at a time. Unset (`undefined`) settings don't override. */
export function mergeConfig(base: ResolvedConfig, over?: CupleConfig): ResolvedConfig {
  if (!over) return base;
  return {
    cache: { ...base.cache, ...defined(over.cache) },
    errors: { ...base.errors, ...defined(over.errors) },
    loading: { ...base.loading, ...defined(over.loading) },
  };
}

function defined<T extends object>(group: T | undefined): Partial<T> {
  if (!group) return {};
  return Object.fromEntries(
    Object.entries(group).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The config in effect here: the provider's, with every `<Boundary config>` above applied. */
export const ConfigContext = createContext<ResolvedConfig>(defaultConfig);

/** The config for one request: what's in effect here, with the request's own on top. */
export function useConfig(own?: CupleConfig): ResolvedConfig {
  return mergeConfig(useContext(ConfigContext), own);
}
