import { once } from "node:events";
import { createClient, type RecursiveApi } from "@cuple/client";
import {
  type CupleConfig,
  CupleProvider,
  type CupleStore,
  createCupleStore,
} from "@cuple/react";
import { type Builder, createBuilder, initRpc } from "@cuple/server";
import {
  act,
  cleanup,
  configure,
  type RenderOptions,
  render,
} from "@testing-library/react";
import express from "express";
import type { ReactElement, ReactNode } from "react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library cannot register this itself.
afterEach(cleanup);

// Every test here does real requests to a real server. Testing Library's 1 s
// default gives way when the machine is busy (a parallel build, many workers);
// a slow request is not a failure. Real hangs still fail, just later.
configure({ asyncUtilTimeout: 3000 });

/**
 * A real server on a free port, a client for it, and one for a port nobody
 * listens on. `network.down = true` drops every connection, like a network
 * failure: the same endpoint, failing at the transport.
 */
export async function serve<T extends RecursiveApi>(
  createRoutes: (builder: Builder) => T,
) {
  const app = express();
  const network = { down: false };
  app.use((req, _res, next) => {
    if (network.down) req.socket.destroy();
    else next();
  });
  initRpc(app, { path: "/rpc", routes: createRoutes(createBuilder(app)) });
  const http = app.listen(0);
  await once(http, "listening");
  const path = `http://localhost:${(http.address() as { port: number }).port}/rpc`;
  return {
    client: createClient<T>({ path }),
    offline: createClient<T>({ path: "http://localhost:1/rpc" }),
    network,
    close: () => http.close(),
  };
}

/** A fresh store per test, and a wrapper rendering under it. */
export function setup(config?: CupleConfig) {
  const store: CupleStore = createCupleStore();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <CupleProvider store={store} config={config}>
        {children}
      </CupleProvider>
    );
  }
  return { store, wrapper };
}

/** Counts calls per route, so tests can tell a refetch from a cache hit. */
export function counter() {
  const counts: Record<string, number> = {};
  return {
    hit(name: string) {
      counts[name] = (counts[name] ?? 0) + 1;
    },
    of(name: string) {
      return counts[name] ?? 0;
    },
  };
}

/** A promise the test resolves by hand, to hold a server response mid-flight. */
export function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * `render`, inside an awaited `act`. React 19 drops the retry of a component
 * that suspends inside a synchronous `act` — which plain `render` is — so a
 * Suspense test rendered without this never leaves its fallback.
 */
export async function renderAsync(ui: ReactElement, options?: RenderOptions) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui, options);
  });
  return result;
}
