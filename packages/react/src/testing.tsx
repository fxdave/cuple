import {
  act,
  type RenderOptions,
  type RenderResult,
  render,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { CupleConfig } from "./config";
import { CupleProvider } from "./provider";
import { type CupleStore, createCupleStore } from "./store";

/**
 * Testing Library's `render`, set up for Cuple: under a `<CupleProvider>` with a
 * fresh store, and inside an awaited `act`.
 *
 * The `act` matters: React 19 drops the retry of a component that suspends
 * inside a synchronous `act`, which plain `render` is, so a Suspense tree
 * rendered without it never leaves its fallback.
 *
 * ```tsx
 * await renderWithCuple(<Boundary fallback="loading"><Todos /></Boundary>);
 * expect(await screen.findByText("milk")).toBeDefined();
 * ```
 */
export async function renderWithCuple(
  ui: ReactElement,
  options: RenderOptions & {
    /** Defaults to a fresh store, so tests never share cached data. */
    store?: CupleStore;
    /** The provider's config. */
    config?: CupleConfig;
  } = {},
): Promise<RenderResult & { store: CupleStore }> {
  const { store = createCupleStore(), config, wrapper: Inner, ...rest } = options;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CupleProvider store={store} config={config}>
        {Inner ? <Inner>{children}</Inner> : children}
      </CupleProvider>
    );
  }
  let result!: RenderResult;
  await act(async () => {
    result = render(ui, { ...rest, wrapper: Wrapper });
  });
  return { ...result, store };
}

/**
 * A handler for every endpoint you mock, shaped like the client:
 * `{ getTodo: { get: ({ params }) => ({ result: "success", statusCode: 200, … }) } }`.
 * Inputs and results are typed from the routes, so a mock can't drift from the
 * API without a type error.
 */
export type MockHandlers<TApi> = {
  [K in keyof TApi]?: TApi[K] extends {
    tInput: infer TInput;
    tOutput: infer TOutput;
    tMethod: infer TMethod extends string;
  }
    ? { [M in TMethod]?: (input: TInput) => TOutput | Promise<TOutput> }
    : MockHandlers<TApi[K]>;
};

export type MockCall = {
  /** The endpoint as the client names it, e.g. `"admin.stats.get"`. */
  endpoint: string;
  /** What the handler received: `params`, `query`, `body`, `headers`. */
  input: Record<string, unknown>;
};

/**
 * A fake server for frontend tests, typed from the server's routes — for when
 * the tests can't (or shouldn't) run the real one.
 *
 * ```ts
 * const mock = mockCuple<typeof routes>({
 *   getTodos: { get: () => ({ result: "success", statusCode: 200, todos: [] }) },
 * });
 * vi.stubGlobal("fetch", mock.fetch);
 * ```
 *
 * A request with no handler fails with the endpoint's name, so a missing mock
 * is obvious. `calls` records every request, in order. Streams (SSE) are not
 * supported.
 */
export function mockCuple<TApi>(handlers: MockHandlers<TApi>) {
  const calls: MockCall[] = [];

  async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? "GET").toLowerCase();
    const headers = new Headers(init?.headers);
    const readsQuery = method === "get" || method === "delete";
    const meta = JSON.parse(
      (readsQuery ? url.searchParams.get("data") : headers.get("X-Cuple-RPC")) ?? "{}",
    ) as { segments?: string[]; params?: unknown; query?: unknown; body?: unknown };
    const body = readsQuery
      ? meta.body
      : typeof init?.body === "string"
        ? JSON.parse(init.body)
        : init?.body;

    const path = [...(meta.segments ?? []), method];
    const endpoint = path.join(".");
    let handler: unknown = handlers;
    for (const segment of path)
      handler = (handler as Record<string, unknown> | undefined)?.[segment];
    if (typeof handler !== "function")
      throw new Error(`mockCuple: no handler for ${endpoint}`);

    const received = Object.fromEntries(
      Object.entries({
        params: meta.params,
        query: meta.query,
        body,
        headers: headersObject(headers),
      }).filter(([, value]) => value !== undefined),
    );
    calls.push({ endpoint, input: received });
    const result = (await handler(received)) as { statusCode?: number };
    return new Response(JSON.stringify(result), {
      status: result.statusCode ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** Not `Object.fromEntries(headers)`: that needs the DOM.Iterable lib. */
function headersObject(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
