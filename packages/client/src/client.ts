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

export class CuplePromise<T extends { result: string }> extends Promise<T> {
  static fromPromise<U extends { result: string }>(p: Promise<U>) {
    return new CuplePromise<U>((resolve, reject) => {
      p.then(resolve).catch(reject);
    });
  }
  /** Keep success result, throw error otherwise. */
  thenUnwrap(): CuplePromise<Extract<T, { result: "success" }>> {
    return CuplePromise.fromPromise(
      (async () => {
        const response: any = await this;
        if (response && typeof response === "object" && response?.result === "success") {
          return response;
        } else {
          throw new CupleUnexpectedResponseError(response);
        }
      })(),
    );
  }
  /** Keep the expected results, throw error otherwise. */
  thenUnwrapOn<TResult extends T["result"]>(
    results: TResult[],
  ): CuplePromise<T & { result: TResult }> {
    return CuplePromise.fromPromise(
      (async () => {
        const response: any = await this;
        if (
          response &&
          typeof response === "object" &&
          results.includes(response?.result)
        ) {
          return response;
        } else {
          throw new CupleUnexpectedResponseError(response);
        }
      })(),
    );
  }

  thenWrapAbort(): CuplePromise<
    T | { result: "abort"; statusCode: null; message: string }
  > {
    return CuplePromise.fromPromise(
      (async () => {
        try {
          return (await this) as any;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            return { result: "abort", statusCode: null, message: "Request aborted" };
          } else {
            throw e;
          }
        }
      })(),
    );
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

export type FetchCupleArgs<TEndpoint extends ClientEndpointRef> =
  {} extends TEndpoint["tInput"]
    ? [options?: Merge<TEndpoint["tInput"], GenericOptions>]
    : [options: Merge<TEndpoint["tInput"], GenericOptions>];

export function fetchCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  ...args: FetchCupleArgs<TEndpoint>
): CuplePromise<TEndpoint["tOutput"]> {
  return CuplePromise.fromPromise(_fetchCuple(endpoint, ...args));
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
  const response = await methodAwareFetch(
    method,
    getData,
    endpoint.clientProps.path,
    options?.options as RequestInit,
  );

  // parsing should throw an error as it's unexpected
  const res = await response.json();
  (res as any).statusCode = response.status;
  return res as TEndpoint["tOutput"];
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
  return CuplePromise.fromPromise(_fetchCupleSSE(endpoint, ...args));
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
  const response = await methodAwareFetch(
    method,
    getData,
    endpoint.clientProps.path,
    options?.options as RequestInit,
  );

  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("text/event-stream")) {
    // Middleware error - parse as JSON
    const res = await response.json();
    (res as any).statusCode = response.status;
    return res as TEndpoint["tOutput"];
  }

  // SSE stream
  const stream = parseSSEStream(response);
  return Object.assign(stream, {
    result: "success" as const,
    statusCode: 200 as const,
  }) as any;
}

async function* parseSSEStream(response: Response): AsyncGenerator<any> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          yield JSON.parse(data);
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6);
      yield JSON.parse(data);
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
   * Identifies the principal this client acts as, for cache integrations.
   *
   * `middleware` runs *per request*, so a cache has no way to tell two users'
   * responses apart from the endpoint alone — without a key they share one
   * entry. Supply something that identifies the user (a uid), never the
   * credential itself: a key that changes on every token refresh would discard
   * the cache hourly and orphan pending invalidations.
   *
   * A getter must be synchronous, since the key is built during render. It is
   * read on each render, so the identity behind it has to live somewhere that
   * re-renders the tree — otherwise pass a plain string and build one client
   * per principal.
   */
  key?: string | (() => string);
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
        };
      }

      // Special handling for "with" method
      if (nameStr === "with") {
        return (target as any).with;
      }

      // Every other property access adds a segment and returns a new Proxy
      return createPathBuilder(path, [...segments, nameStr], middleware, key);
    },
    apply(target, thisArg, argumentsList: any[]) {
      if (segments[0] === "with" && middleware === undefined && key === undefined) {
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
 */
async function methodAwareFetch(
  method: string,
  getData: () => Promise<{ segments: string[]; argument: Record<string, unknown> }>,
  path: string,
  options?: RequestInit,
) {
  const { segments, argument } = await getData();
  const { headers, body, options: _options, ...meta } = argument;
  const customHeaders =
    typeof headers === "object" ? (headers as Record<string, string>) : {};

  if (method === "get" || method === "delete") {
    const data = JSON.stringify({ segments, ...meta, body });
    const params = new URLSearchParams({ data });
    return await fetch(`${path}?${params.toString()}`, {
      method: method.toUpperCase(),
      headers: {
        Accept: "application/json",
        ...customHeaders,
      },
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
      Accept: "application/json",
      ...customHeaders,
    },
    ...options,
  });
}
