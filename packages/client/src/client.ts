/* eslint-disable @typescript-eslint/ban-types */
import { MapApi } from "./map-api";

export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, [], undefined);
}

type Merge<T extends object, U extends object> = Prettify<Omit<T, keyof U> & U>;

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
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
  thenUnwrap(): CuplePromise<T & { result: "success" }> {
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
          if (e instanceof DOMException && e.name == "AbortError") {
            return { result: "abort", statusCode: null, message: "Request aborted" };
          } else {
            throw e;
          }
        }
      })(),
    );
  }
}

export type ClientEndpointRef = {
  tInput: Record<string, unknown>;
  tOutput: any;
  tMethod: any;
  clientProps: {
    method: any;
    segments: any;
    path: any;
    preloader?: () => any;
  };
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
        ...(endpoint.clientProps.preloader !== undefined
          ? await endpoint.clientProps.preloader()
          : {}),
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

export type Client<
  TApi extends RecursiveApi,
  TPreloadedData = NonNullable<unknown>,
> = MapApi<TApi, TPreloadedData> &
  (NonNullable<unknown> extends TPreloadedData
    ? {
        with: <TParamsNext>(
          middleware: () => Promise<TParamsNext> | TParamsNext,
        ) => Client<TApi, TParamsNext>;
      }
    : NonNullable<unknown>);

function createPathBuilder<TApi extends RecursiveApi, TParams = NonNullable<unknown>>(
  path: string,
  segments: string[],
  preloader?: () => Promise<TParams> | TParams,
): Client<TApi, TParams> {
  const target = (() => false) as unknown as Client<TApi, TParams>;

  target.with = <TParamsNext>(preloader: () => Promise<TParamsNext> | TParamsNext) => {
    return createPathBuilder<TApi, TParamsNext>(path, [], preloader);
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
          preloader,
        };
      }

      // Special handling for "with" method
      if (nameStr === "with") {
        return (target as any).with;
      }

      // Every other property access adds a segment and returns a new Proxy
      return createPathBuilder(path, [...segments, nameStr], preloader);
    },
    apply(target, thisArg, argumentsList: any[]) {
      if (segments[0] === "with" && preloader === undefined) {
        return (target as any).with(argumentsList[0]);
      }

      throw new Error("Endpoints must be called via fetchCuple(endpoint, options)");
    },
  });
}

/**
 * Run fetch with data added to body or query depending on the method
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
  const {
    segments,
    argument: { headers, ...argument },
  } = await getData();
  const data = JSON.stringify({ segments, argument });
  if (method === "get" || method === "delete") {
    const argument = new URLSearchParams({ data });
    return await fetch(`${path}?${argument.toString()}`, {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(typeof headers === "object" ? headers : {}),
      },
      ...options,
    });
  }
  return await fetch(path, {
    body: data,
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(typeof headers === "object" ? headers : {}),
    },
    ...options,
  });
}
