import { createContext, useContext } from "react";
import type { CupleError } from "./errors";

/**
 * What happens to an error nobody handled (a result nobody listed, a network
 * failure nobody listed as `"transport-error"`, a bug):
 * - `"boundary"`: the nearest `<Boundary>` shows it.
 * - `"notify"`: `errors.notify` shows it; the page stays.
 */
export type Unhandled = "boundary" | "notify";

/** One choice for every unhandled error, or a choice per error. */
export type UnhandledPolicy = Unhandled | ((error: CupleError) => Unhandled);

/**
 * How Cuple behaves, grouped by concern. The same shape is accepted by
 * `<CupleProvider config>`, `<Boundary config>` and each request's
 * `{ config }`. Every setting cascades on its own — request over Boundary over
 * Provider over the built-in default — so setting `cache.keep` somewhere never
 * resets `cache.refreshOnRead` from above.
 */
export type CupleConfig = {
  cache?: {
    /**
     * How long data nobody reads stays in memory, in ms. `0` drops it as soon
     * as the last reader unmounts. With several readers, the longest wins.
     * Default: 5 minutes.
     */
    keep?: number;
    /**
     * What happens when a component starts reading data that is already
     * cached — switching back to a tab, reopening a panel:
     * - `"stale"`: show it at once; refetch in the background if it's older
     *   than `freshFor`. The screen updates when the new data lands.
     * - `"always"`: show it at once and always refetch in the background.
     * - `"never"`: show it; nothing refetches.
     *
     * A first load is never fetched twice. Default: `"stale"`.
     */
    refreshOnRead?: "never" | "stale" | "always";
    /** How long data counts as fresh for `refreshOnRead: "stale"`, in ms. Default: 0. */
    freshFor?: number;
    /**
     * What `store.refreshKeys()` does with data whose key changed (the user a
     * `with({ key })` getter returns, say): `"drop"` deletes it at once;
     * `"keep"` keeps it for `keep` ms, so switching back is instant.
     * Read from the provider. Default: `"drop"`.
     */
    onKeyChange?: "drop" | "keep";
  };
  errors?: {
    /**
     * Actions: what happens to an error nobody handled. Errors you handle are
     * the results you list with `thenResolveAlso` — typed values that never
     * get here. Default: `"boundary"`.
     */
    unhandled?: UnhandledPolicy;
    /**
     * How the app shows an error without replacing the page: a toast, a
     * banner. Used by `unhandled: "notify"` and `<Boundary error="notify">`.
     */
    notify?: (error: CupleError) => void;
    /**
     * The message when there's nothing readable to show: a network failure,
     * a server result without a message, a bug in production.
     * Default: `"Something went wrong."`
     */
    message?: string;
  };
  loading?: {
    /**
     * Makes `useIsFetching({ blocking: true })` true: for actions while they
     * run, for reads while their data refetches. For a full-page overlay.
     */
    blocking?: boolean;
    /** Reads only: refetch every this many ms while something reads it. */
    every?: number;
  };
};

/** Every setting resolved: the built-in defaults, with the cascade applied. */
export type ResolvedConfig = {
  cache: Required<NonNullable<CupleConfig["cache"]>>;
  errors: {
    unhandled: UnhandledPolicy;
    notify?: (error: CupleError) => void;
    message: string;
  };
  loading: { blocking: boolean; every?: number };
};

export const defaultConfig: ResolvedConfig = {
  cache: { keep: 5 * 60_000, refreshOnRead: "stale", freshFor: 0, onKeyChange: "drop" },
  errors: { unhandled: "boundary", message: "Something went wrong." },
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
