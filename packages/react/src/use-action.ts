import { useCallback, useEffect, useRef, useState } from "react";
import { type CupleConfig, useConfig } from "./config";
import { type CupleError, toCupleError } from "./errors";
import { missingNotify, useCupleContext } from "./provider";
import type { Readable } from "./types";

/**
 * Where an action is. Discriminated on `status`, so `value` and `error` only
 * exist when they mean something:
 *
 * - `idle`: nothing has happened yet
 * - `pending`: running, including the refresh it asked for
 * - `done`: your function finished. `value` is what it returned — including
 *   failures: `fetchCuple` resolves every server result unless you narrow it
 *   with `thenKeep([...])`, so `done` does not mean "succeeded"; check
 *   `value.result`. Resolved failures are handled: they're yours to show, typed.
 * - `failed`: an error nobody handled. It already went where
 *   `config.errors.onError` says: the nearest `<Boundary>` (this component
 *   is then off screen), `errors.notify`, or nowhere (`null`: this component
 *   shows it). Unless it's yours to show, don't report it again; use it only
 *   to adjust what's on screen, e.g. re-enable a button.
 */
export type ActionState<T> =
  | { status: "idle"; value?: undefined; error?: undefined }
  | { status: "pending"; value?: undefined; error?: undefined }
  | { status: "done"; value: T; error?: undefined }
  | { status: "failed"; value?: undefined; error: CupleError };

/** The `result` values a function can return, when it returns Cuple results. */
type ResultOf<T> = T extends { result: infer R extends string } ? R : never;

export type ActionOptions<T> = {
  /**
   * This action's settings, over the `<Boundary>`'s and the provider's. The
   * ones actions use:
   * - `errors.onError`: where an error nobody handled goes — `"boundary"`
   *   (default), `"notify"`, `null` (handled), or a function choosing per error
   * - `errors.notify`, `errors.fallbackMessage`: how it's shown, and the fallback text
   * - `loading.blocking`: while it runs, including its refresh,
   *   `useIsFetching({ blocking: true })` is true — for a full-page overlay
   */
  config?: CupleConfig;
  /**
   * What this action changes, refreshed once the function finishes. Nothing is
   * refreshed unless it is named here.
   *
   * - `[client.getTodos.get]`: every time the function finishes.
   * - `{ success: [client.getTodos.get] }`: only for the listed results. The
   *   keys are the `result`s the function can return.
   *
   * Combined reads that fetched a listed endpoint through `get` are refreshed too.
   */
  refresh?:
    | readonly Readable[]
    // Only for functions returning Cuple results: without a `result`, a map
    // could never match, and the refresh would silently never happen.
    | ([ResultOf<T>] extends [never]
        ? never
        : { readonly [K in ResultOf<T>]?: readonly Readable[] });
};

export type Action<TArgs extends unknown[], T> = ActionState<T> & {
  /** `status === "pending"`. */
  isPending: boolean;
  /**
   * Runs the function. Resolves with the resulting state — always: it never
   * rejects, so an event handler never produces an unhandled rejection, and a
   * form library awaiting it never hangs.
   */
  run: (...args: TArgs) => Promise<ActionState<T>>;
  /** Back to `idle`, e.g. to hide a "Saved" message. */
  reset: () => void;
};

/**
 * Runs async work — usually a write — with its state, error routing and refresh.
 *
 * ```tsx
 * const save = useAction(
 *   (values: FormValues) =>
 *     fetchCuple(client.updateOrder.put, { params: { id }, body: values })
 *       .thenKeep(["success", "invalid-body"]),
 *   { refresh: [client.getOrder.get, client.getOrders.get] },
 * );
 *
 * <form onSubmit={form.handleSubmit(save.run)}>
 * {save.value?.result === "success" && <p>Saved</p>}
 * {save.value?.result === "invalid-body" && <Issues issues={save.value.issues} />}
 * ```
 *
 * The state is the latest run's. An earlier run that finishes later still
 * writes and refreshes, but doesn't change what is shown. For one action per
 * row with its own state, call `useAction` in the row component. When the
 * component moves to another item, give it a `key` so the old result isn't
 * shown for the new item.
 */
export function useAction<TArgs extends unknown[], T>(
  fn: (...args: TArgs) => Promise<T>,
  options?: ActionOptions<T>,
): Action<TArgs, T> {
  const { store } = useCupleContext();
  const config = useConfig(options?.config);
  const [state, setState] = useState<ActionState<T>>({ status: "idle" });
  const [, throwToBoundary] = useState<never>();
  const latest = useRef({ fn, options, config });
  latest.current = { fn, options, config };
  const lastRun = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    (...args: TArgs): Promise<ActionState<T>> =>
      store.track(
        async () => {
          const id = ++lastRun.current;
          const { fn, options, config } = latest.current;
          /** To the nearest boundary; reported instead when there's none left to show it. */
          const raise = (error: unknown) => {
            if (mounted.current) {
              throwToBoundary(() => {
                throw error;
              });
            } else {
              reportUncaught(error);
            }
          };

          setState({ status: "pending" });
          let next: ActionState<T>;
          try {
            const value = await fn(...args);
            const refresh = refreshFor(options?.refresh, value);
            if (refresh.length) await store.refresh(refresh);
            next = { status: "done", value };
          } catch (error) {
            // Nobody handled it: handled failures are listed results, returned above.
            const unhandled = toCupleError(error, config.errors.fallbackMessage);
            next = { status: "failed", error: unhandled };
            const { onError } = config.errors;
            const route = typeof onError === "function" ? onError(unhandled) : onError;
            if (route === "boundary") raise(error);
            else if (route === "notify") {
              if (config.errors.notify) config.errors.notify(unhandled);
              else raise(missingNotify(error));
            }
          }
          if (id === lastRun.current) setState(next);
          return next;
        },
        { blocking: latest.current.config.loading.blocking },
      ),
    [store],
  );

  const reset = useCallback(() => {
    lastRun.current++;
    setState({ status: "idle" });
  }, []);

  return { ...state, isPending: state.status === "pending", run, reset } as Action<
    TArgs,
    T
  >;
}

function refreshFor<T>(
  refresh: ActionOptions<T>["refresh"],
  value: T,
): readonly Readable[] {
  if (!refresh) return [];
  if (Array.isArray(refresh)) return refresh;
  const result = (value as { result?: string } | null)?.result;
  return (refresh as Record<string, readonly Readable[]>)[result ?? ""] ?? [];
}

function reportUncaught(error: unknown) {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (report) report(error);
  else console.error(error);
}
