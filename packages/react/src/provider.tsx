import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ConfigContext, type CupleConfig, defaultConfig, mergeConfig } from "./config";
import { type CupleStore, Store } from "./store";

type CupleContextValue = { store: Store };

const CupleContext = createContext<CupleContextValue | null>(null);

/**
 * Makes the store available to the hooks, with the app's config. Once, at the root.
 *
 * ```tsx
 * export const store = createCupleStore();
 *
 * <CupleProvider
 *   store={store}
 *   config={{
 *     errors: {
 *       notify: (error) => toast(error.message),
 *       onError: (error) => (error.kind === "transport" ? "notify" : "boundary"),
 *     },
 *   }}
 * >
 * ```
 */
export function CupleProvider(props: {
  store: CupleStore;
  /**
   * The app-wide defaults. `<Boundary config>` and each request's `{ config }`
   * override them, one setting at a time. Plain code using the store directly
   * (`store.preload`, `store.refreshKeys`) follows this config too.
   */
  config?: CupleConfig;
  children: ReactNode;
}): ReactNode {
  if (!(props.store instanceof Store))
    throw new Error(
      "@cuple/react: <CupleProvider store> needs a store made by createCupleStore()",
    );
  const store = props.store;
  const resolved = useMemo(
    () => mergeConfig(defaultConfig, props.config),
    [props.config],
  );
  store.setDefaults(resolved);
  return (
    <CupleContext.Provider value={{ store }}>
      <ConfigContext.Provider value={resolved}>{props.children}</ConfigContext.Provider>
    </CupleContext.Provider>
  );
}

export function useCupleContext(): CupleContextValue {
  const context = useContext(CupleContext);
  if (!context)
    throw new Error("@cuple/react: wrap your app in <CupleProvider store={...}>");
  return context;
}

/** An error saying `"notify"` was asked for, but no `errors.notify` is configured. */
export function missingNotify(error: unknown): Error {
  const explained = new Error(
    '@cuple/react: "notify" needs config={{ errors: { notify } }} to show the error with',
  );
  (explained as { cause?: unknown }).cause = error;
  return explained;
}
