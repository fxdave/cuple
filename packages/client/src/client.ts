import type { ClientProps, MapApi } from "./map-api";

export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, [], undefined);
}

type Merge<T extends object, U extends object> = Prettify<Omit<T, keyof U> & U>;

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

type GenericOptions = {
  options?: RequestInit;
};

export class CupleUnexpectedResponseError extends Error {
  statusCode: number | null;
  constructor(
    public response?: { result?: string; message?: string; statusCode?: number },
  ) {
    super(response?.message || "Something went wrong");
    this.statusCode = response?.statusCode || null;
  }
}

/**
 * The server did not answer in Cuple's format: it was unreachable (DNS, CORS,
 * offline), or it answered with a body that is not JSON (a proxy's HTML error
 * page). The original error is kept as `cause`.
 *
 * A bug in your own code never produces this, so it is safe to treat as
 * "retry later" rather than "report".
 */
export class CupleTransportError extends Error {
  override name = "CupleTransportError";
  /** What failed underneath: fetch's `TypeError`, or the JSON `SyntaxError`. */
  readonly cause: unknown;
  /** The HTTP status, when a response arrived but its body was not JSON. */
  readonly statusCode: number | null;
  // Not `super(message, { cause })`: that needs the ES2022 lib in every consumer.
  constructor(message: string, options: { cause: unknown; statusCode?: number | null }) {
    super(message);
    this.cause = options.cause;
    this.statusCode = options.statusCode ?? null;
  }
}

/**
 * A network failure as a result, for code that handles it as a value: list
 * `"transport-error"` in `thenResolveAlso`/`thenResolveOn` (or `resolveAlso` on
 * a read). `statusCode` is set when a response arrived but wasn't Cuple's
 * (a proxy's error page); `null` when there was no response at all.
 */
export type TransportErrorResult = {
  result: "transport-error";
  statusCode: number | null;
  message: string;
};

export function transportErrorResult(error: CupleTransportError): TransportErrorResult {
  return {
    result: "transport-error",
    statusCode: error.statusCode,
    message: error.message,
  };
}

/** An aborted request, as a result: list `"abort"` in `thenResolveAlso`/`thenResolveOn`. */
export type AbortResult = { result: "abort"; statusCode: null; message: string };

/**
 * What a {@link CuplePromise} resolves with: the server results in `TKept`
 * (`string` for all of them), plus `TExtra`, the transport error or abort it
 * listed.
 */
export type Kept<TAll extends { result: string }, TKept extends string, TExtra> =
  | (string extends TKept ? TAll : Extract<TAll, { result: TKept }>)
  | TExtra;

/** What can be listed besides the server's results: no response at all. */
type NoResponse = "transport-error" | "abort";

/** The no-response results among the listed ones, as values. */
type ListedNoResponse<TResult> =
  | ("transport-error" extends TResult ? TransportErrorResult : never)
  | ("abort" extends TResult ? AbortResult : never);

type Keep = { all: boolean; listed: ReadonlySet<string> };

/**
 * A request's result. It resolves with `success` and rejects with anything
 * else, unless you list more:
 *
 * | Method                          | Resolves with                                         |
 * | ------------------------------- | ----------------------------------------------------- |
 * | (default)                       | `success`                                             |
 * | `.thenResolveAlso([...])`       | what it resolved with so far, plus the listed results |
 * | `.thenResolveOn([...])`         | exactly the listed results; `"success"` isn't implied |
 * | `.thenResolveAnyResponse()`     | every result the server sent                          |
 * | `.thenResolveAnyResponse()`             | every result, plus `transport-error` and `abort`      |
 *
 * Results it doesn't keep reject as {@link CupleUnexpectedResponseError}; no
 * answer at all rejects as {@link CupleTransportError}, and an abort as
 * `AbortError`. List `"transport-error"` or `"abort"` to keep them.
 *
 * Each method starts from the response again, so they chain in any order.
 */
export class CuplePromise<
  TAll extends { result: string },
  TKept extends string = "success",
  TExtra = never,
> extends Promise<Kept<TAll, TKept, TExtra>> {
  // `.then()` and friends return plain promises: the methods below only make
  // sense on the request itself.
  static get [Symbol.species]() {
    return Promise;
  }

  private response!: Promise<TAll>;
  private keep!: Keep;

  /** `response` is everything the server answered; `keep` says what resolves. */
  static of<
    TAll extends { result: string },
    TKept extends string = "success",
    TExtra = never,
  >(
    response: Promise<TAll>,
    keep: Keep = { all: false, listed: new Set(["success"]) },
  ): CuplePromise<TAll, TKept, TExtra> {
    const promise = new CuplePromise<TAll, TKept, TExtra>((resolve, reject) => {
      response.then(
        (value) => {
          if (keep.all || keep.listed.has(value?.result)) resolve(value as never);
          else reject(new CupleUnexpectedResponseError(value as never));
        },
        (error) => {
          if (error instanceof CupleTransportError && keep.listed.has("transport-error"))
            resolve(transportErrorResult(error) as never);
          else if (isAbort(error) && keep.listed.has("abort"))
            resolve({
              result: "abort",
              statusCode: null,
              message: "Request aborted",
            } as never);
          else reject(error);
        },
      );
    });
    promise.response = response;
    promise.keep = keep;
    return promise;
  }

  /** The same request, keeping something else. This one's rejection is superseded. */
  private rekeep<TNext extends string, TNextExtra>(
    keep: Keep,
  ): CuplePromise<TAll, TNext, TNextExtra> {
    this.catch(() => {});
    return CuplePromise.of<TAll, TNext, TNextExtra>(this.response, keep);
  }

  /**
   * Also resolve with the listed results. `thenResolveAlso(["invalid-body"])`
   * resolves with `success | invalid-body`: the failures your code handles
   * become values, and everything else stays an exception.
   *
   * `"transport-error"` and `"abort"` can be listed too: a network failure then
   * resolves as `{ result: "transport-error", statusCode, message }`, an abort
   * as `{ result: "abort", statusCode: null, message }`.
   */
  thenResolveAlso<const TResult extends TAll["result"] | NoResponse>(
    results: readonly TResult[],
  ): CuplePromise<
    TAll,
    TKept | Exclude<TResult, NoResponse>,
    TExtra | ListedNoResponse<TResult>
  > {
    return this.rekeep({
      all: this.keep.all,
      listed: new Set([...this.keep.listed, ...results]),
    });
  }

  /**
   * Resolve with exactly the listed results. The list is complete:
   * `thenResolveOn(["not-found-error"])` rejects a success too.
   */
  thenResolveOn<const TResult extends TAll["result"] | NoResponse>(
    results: readonly TResult[],
  ): CuplePromise<TAll, Exclude<TResult, NoResponse>, ListedNoResponse<TResult>> {
    return this.rekeep({ all: false, listed: new Set(results) });
  }

  /**
   * Resolve with every result the server sent, for code that forwards
   * responses as they are. No response at all (a network failure, an abort)
   * still rejects.
   */
  thenResolveAnyResponse(): CuplePromise<TAll, string, TExtra> {
    return this.rekeep({ all: true, listed: this.keep.listed });
  }

  /**
   * Resolve with everything: every result the server sent, plus
   * `transport-error` and `abort`. Only a bug in your own code rejects.
   */
  thenResolveAll(): CuplePromise<TAll, string, TransportErrorResult | AbortResult> {
    return this.rekeep({
      all: true,
      listed: new Set([...this.keep.listed, "transport-error", "abort"]),
    });
  }
}

/** Runs a client's middleware, if it has one. */
async function runMiddleware(
  middleware?: () => unknown,
): Promise<Record<string, unknown>> {
  if (middleware === undefined) return {};
  return ((await middleware()) ?? {}) as Record<string, unknown>;
}

export type ClientEndpointRef = {
  tInput: Record<string, unknown>;
  tOutput: any;
  tMethod: any;
  _sse?: never;
  clientProps: ClientProps;
};

/** Everything an endpoint can resolve to. */
export type CupleResult<TEndpoint extends ClientEndpointRef> = TEndpoint["tOutput"];

/** Just the successful case: what `fetchCuple` resolves with by default. */
export type CupleSuccess<TEndpoint extends ClientEndpointRef> = Extract<
  CupleResult<TEndpoint>,
  { result: "success" }
>;

/** One named case, e.g. `CupleResultOf<typeof e, "notFound">`. */
export type CupleResultOf<
  TEndpoint extends ClientEndpointRef,
  TResult extends string,
> = Extract<CupleResult<TEndpoint>, { result: TResult }>;

export type FetchCupleArgs<TEndpoint extends ClientEndpointRef> =
  {} extends TEndpoint["tInput"]
    ? [options?: Merge<TEndpoint["tInput"], GenericOptions>]
    : [options: Merge<TEndpoint["tInput"], GenericOptions>];

/**
 * Sends one request. It resolves with `success`, and rejects otherwise:
 *
 * | Outcome                                     | Rejects with                          |
 * | ------------------------------------------- | ------------------------------------- |
 * | Any other result (a 404, an `invalid-body`) | `CupleUnexpectedResponseError`        |
 * | No response: unreachable, DNS, CORS         | `CupleTransportError`                 |
 * | Body is not JSON: proxy HTML, gateway page  | `CupleTransportError` (`statusCode`)  |
 * | `options.signal` aborted                    | `DOMException` (`name: "AbortError"`) |
 *
 * List the outcomes your code handles, and they resolve as typed values
 * instead: `.thenResolveAlso(["invalid-body", "transport-error"])`. See
 * {@link CuplePromise}. The HTTP status is never interpreted: it is copied onto
 * the result as `statusCode`, and which `result` goes with which status is the
 * server's choice, set by `apiResponse`.
 *
 * A non-JSON body is always an error here — `fetchCuple` only speaks Cuple's
 * envelope. For downloads, streams and any other custom response, define the
 * route with `getRaw`/`postRaw`/… on the server and call it with plain `fetch`;
 * raw routes are not part of the client API. (Raw *request* bodies are fine:
 * pass an `ArrayBuffer`, `Blob`, `Uint8Array` or `ReadableStream` as `body`.)
 */
export function fetchCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  ...args: FetchCupleArgs<TEndpoint>
): CuplePromise<TEndpoint["tOutput"]> {
  return CuplePromise.of(_fetchCuple(endpoint, ...args));
}

async function _fetchCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  ...args: FetchCupleArgs<TEndpoint>
): Promise<TEndpoint["tOutput"]> {
  const options = args[0];
  const method = endpoint.clientProps.method;
  const getData = async () => {
    return {
      segments: endpoint.clientProps.segments,
      argument: {
        ...(await runMiddleware(endpoint.clientProps.middleware)),
        ...options,
      },
    };
  };
  const response = await transportFetch(() =>
    methodAwareFetch(
      method,
      getData,
      endpoint.clientProps.path,
      options?.options as RequestInit,
    ),
  );
  const res = await readJson(response);
  (res as any).statusCode = response.status;
  return (await runFinalware(
    endpoint.clientProps.finalware,
    res,
  )) as TEndpoint["tOutput"];
}

function isAbort(error: unknown) {
  return (error as { name?: string } | null)?.name === "AbortError";
}

/** Runs a network step; anything but an abort becomes a {@link CupleTransportError}. */
async function transportFetch<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isAbort(error) || error instanceof CupleTransportError) throw error;
    throw new CupleTransportError(
      `The server could not be reached: ${(error as Error)?.message ?? error}`,
      { cause: error },
    );
  }
}

/** A body that is not JSON is not a Cuple response: a proxy or gateway answered. */
async function readJson(response: Response): Promise<any> {
  const text = await transportFetch(() => response.text());
  return parseJson(text, response.status);
}

function parseJson(text: string, statusCode: number): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CupleTransportError(
      `The server answered ${statusCode} with a body that is not JSON`,
      { cause: error, statusCode },
    );
  }
}

/** A finalware's return value replaces the response; returning nothing keeps it. */
async function runFinalware(
  finalware: ((response: any) => unknown | Promise<unknown>) | undefined,
  response: unknown,
) {
  if (finalware === undefined) return response;
  const replaced = await finalware(response);
  return replaced === undefined ? response : replaced;
}

export type ClientSSEEndpointRef = {
  tInput: Record<string, unknown>;
  tOutput: any;
  tMethod: any;
  _sse: true;
  clientProps: ClientProps;
};

export type FetchCupleSSEArgs<TEndpoint extends ClientSSEEndpointRef> =
  {} extends TEndpoint["tInput"]
    ? [options?: Merge<TEndpoint["tInput"], GenericOptions>]
    : [options: Merge<TEndpoint["tInput"], GenericOptions>];

export function fetchCupleSSE<TEndpoint extends ClientSSEEndpointRef>(
  endpoint: TEndpoint,
  ...args: FetchCupleSSEArgs<TEndpoint>
): CuplePromise<TEndpoint["tOutput"]> {
  return CuplePromise.of(_fetchCupleSSE(endpoint, ...args));
}

async function _fetchCupleSSE<TEndpoint extends ClientSSEEndpointRef>(
  endpoint: TEndpoint,
  ...args: FetchCupleSSEArgs<TEndpoint>
): Promise<TEndpoint["tOutput"]> {
  const options = args[0];
  const method = endpoint.clientProps.method;
  const getData = async () => {
    return {
      segments: endpoint.clientProps.segments,
      argument: {
        ...(await runMiddleware(endpoint.clientProps.middleware)),
        ...options,
      },
    };
  };
  const response = await transportFetch(() =>
    methodAwareFetch(
      method,
      getData,
      endpoint.clientProps.path,
      options?.options as RequestInit,
      "stream",
    ),
  );

  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("text/event-stream")) {
    // Middleware error - parse as JSON
    const res = await readJson(response);
    (res as any).statusCode = response.status;
    return (await runFinalware(
      endpoint.clientProps.finalware,
      res,
    )) as TEndpoint["tOutput"];
  }

  // SSE stream
  const stream = parseSSEStream(response);
  const result = Object.assign(stream, {
    result: "success" as const,
    statusCode: 200 as const,
  });
  return (await runFinalware(endpoint.clientProps.finalware, result)) as any;
}

async function* parseSSEStream(response: Response): AsyncGenerator<any> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await transportFetch(() => reader.read());
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          yield parseJson(line.slice(6), response.status);
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith("data: ")) {
      yield parseJson(buffer.slice(6), response.status);
    }
  } finally {
    reader.releaseLock();
  }
}

export type RecursiveApi = {
  [Key in string]:
    | {
        tInput: any;
        tOutput: any;
        tMethod: any;
        _handler: (req: any, res: any) => void;
        _method: any;
      }
    | RecursiveApi;
};

/**
 * Options for `client.with(..)`.
 *
 * The two fields are deliberately separate concerns: `data` is about the
 * *request*, `key` is about the *cache*. A cookie-authenticated app needs only
 * `key`; a static API-key client needs only `data`.
 */
export type CupleWithOptions<TParams> = {
  /**
   * Runs before every request this client sends; what it returns is merged into
   * the request data, under the per-call options. Awaited at fetch time, so it
   * can refresh a token.
   */
  middleware?: () => Promise<TParams> | TParams;
  /**
   * Identifies what `middleware` injects, for cache integrations.
   *
   * `middleware` runs *per request*, so nothing it returns reaches the cache
   * key: two calls that differ only in what it injected would share one entry.
   * This is how a cache tells them apart. Most often that is who the request is
   * for, but it is whatever the middleware actually varies by — a tenant, a
   * locale, an API version.
   *
   * Key what the response depends on, not the injected bytes. A refreshed token
   * is new data but the same identity; a key that moved with it would discard
   * the cache on every refresh and orphan pending invalidations.
   *
   * A getter must be synchronous, since the key is built during render. It is
   * read on each render, so whatever it reads has to live somewhere that
   * re-renders the tree — otherwise pass a plain string and build one client
   * per value.
   */
  key?: string | (() => string);
  /**
   * Runs after every response this client receives, before it is handed back.
   *
   * For the cross-cutting work that has to happen whether or not a hook is
   * involved: redirecting on an expired session, reporting failures. Throwing
   * from here turns a result into an exception, which is how a redirect works.
   *
   * Returning a value replaces the response; returning nothing keeps it.
   *
   * **The types do not follow it.** A replaced response still has the endpoint's
   * declared type, because the response type is fixed by the route definition
   * and there is no way to thread a per-client transformation back through it.
   * Reshaping data here will lie to every caller — observe, throw, or narrow by
   * hand at the call site.
   */
  finalware?: (response: any) => unknown | Promise<unknown>;
};

export type Client<
  TApi extends RecursiveApi,
  TPreloadedData = NonNullable<unknown>,
> = MapApi<TApi, TPreloadedData> &
  (NonNullable<unknown> extends TPreloadedData
    ? {
        with: <TParamsNext = NonNullable<unknown>>(
          options: CupleWithOptions<TParamsNext>,
        ) => Client<TApi, TParamsNext>;
      }
    : NonNullable<unknown>);

function createPathBuilder<TApi extends RecursiveApi, TParams = NonNullable<unknown>>(
  path: string,
  segments: string[],
  middleware?: () => Promise<TParams> | TParams,
  key?: string | (() => string),
  finalware?: (response: any) => unknown | Promise<unknown>,
): Client<TApi, TParams> {
  const target = (() => false) as unknown as Client<TApi, TParams>;

  target.with = <TParamsNext = NonNullable<unknown>>(
    options: CupleWithOptions<TParamsNext>,
  ) => {
    return createPathBuilder<TApi, TParamsNext>(
      path,
      [],
      options.middleware,
      options.key,
      options.finalware,
    );
  };

  return new Proxy<Client<TApi, TParams>>(target, {
    get(_target, name, _receiver) {
      const nameStr = name as string;

      // Special handling for clientProps - return the accumulated routing metadata
      if (nameStr === "clientProps") {
        // The last segment should be the HTTP method
        const method = segments[segments.length - 1];
        const routeSegments = segments.slice(0, -1);
        return {
          method,
          segments: routeSegments,
          path,
          middleware,
          key,
          finalware,
        };
      }

      // Special handling for "with" method
      if (nameStr === "with") {
        return (target as any).with;
      }

      // Every other property access adds a segment and returns a new Proxy
      return createPathBuilder(path, [...segments, nameStr], middleware, key, finalware);
    },
    apply(target, thisArg, argumentsList: any[]) {
      if (
        segments[0] === "with" &&
        middleware === undefined &&
        key === undefined &&
        finalware === undefined
      ) {
        return (target as any).with(argumentsList[0]);
      }

      throw new Error("Endpoints must be called via fetchCuple(endpoint, options)");
    },
  });
}

function isRawBody(body: unknown): boolean {
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof Uint8Array !== "undefined" && body instanceof Uint8Array) return true;
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
    return true;
  return false;
}

/**
 * Run fetch with RPC routing metadata separated from the body.
 * GET/DELETE: metadata (segments, params, query, body) in query param `data`.
 * POST/PUT/PATCH: metadata (segments, params, query) in `X-Cuple-RPC` header,
 * body sent as actual HTTP body (JSON-stringified or raw).
 * @param method get, post, put, patch, delete
 * @param getData data factory for body, query, headers
 * @param path the path, usually the rpc's endpoint
 * @param options fetch's options
 * @param expects `"stream"` for SSE: asks for an event stream and bypasses the
 *   HTTP cache, as `EventSource` does, so a browser never holds one tab's
 *   stream behind another's identical request.
 */
async function methodAwareFetch(
  method: string,
  getData: () => Promise<{ segments: string[]; argument: Record<string, unknown> }>,
  path: string,
  options?: RequestInit,
  expects: "json" | "stream" = "json",
) {
  const { segments, argument } = await getData();
  const negotiation: { headers: Record<string, string>; init: RequestInit } =
    expects === "stream"
      ? {
          headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
          init: { cache: "no-store" },
        }
      : { headers: { Accept: "application/json" }, init: {} };
  const { headers, body, options: _options, ...meta } = argument;
  const customHeaders =
    typeof headers === "object" ? (headers as Record<string, string>) : {};

  if (method === "get" || method === "delete") {
    const data = JSON.stringify({ segments, ...meta, body });
    const params = new URLSearchParams({ data });
    return await fetch(`${path}?${params.toString()}`, {
      method: method.toUpperCase(),
      headers: {
        ...negotiation.headers,
        ...customHeaders,
      },
      ...negotiation.init,
      ...options,
    });
  }

  const rpcMeta = JSON.stringify({ segments, ...meta });
  const raw = isRawBody(body);
  return await fetch(path, {
    body: raw
      ? (body as RequestInit["body"])
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
    method: method.toUpperCase(),
    headers: {
      "X-Cuple-RPC": rpcMeta,
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...negotiation.headers,
      ...customHeaders,
    },
    ...negotiation.init,
    ...options,
  });
}
