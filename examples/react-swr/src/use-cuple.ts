import {
  type ClientEndpointRef,
  CupleUnexpectedResponseError,
  cupleRequestKey,
  type FetchCupleArgs,
  fetchCuple,
} from "@cuple/client";
import useSWR, { type SWRConfiguration, useSWRConfig } from "swr";
import useSWRMutation, { type SWRMutationConfiguration } from "swr/mutation";

type CupleArgs<TEndpoint extends ClientEndpointRef> = FetchCupleArgs<TEndpoint>[0];

type CupleOptions<TEndpoint extends ClientEndpointRef> = CupleArgs<TEndpoint> | null;

type CupleResult<TEndpoint extends ClientEndpointRef> = Awaited<
  ReturnType<typeof fetchCuple<TEndpoint>>
>;

/**
 * SWR retries every rejection, and by default forever: `shouldRetryOnError` is
 * `true`, the built-in `onErrorRetry` ignores the error, and `errorRetryCount`
 * has no default, so the count guard never fires. A request cancelled through
 * `options.signal` would be re-issued indefinitely — so exclude aborts, which
 * are a decision, not a failure.
 */
function notAborted(err: unknown) {
  return (err as { name?: string })?.name !== "AbortError";
}

/**
 * Null options suspends the fetch.
 *
 * No AbortController here on purpose: SWR shares one in-flight request per key
 * between every component using it, so a per-component abort would cancel a
 * request others are still waiting on. Pass `options.signal` to cancel one
 * yourself; SWR already discards responses from superseded requests.
 */
export function useCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  options: CupleOptions<TEndpoint>,
  swrConfig?: SWRConfiguration,
) {
  const key = options !== null ? cupleRequestKey(endpoint, options) : null;

  return useSWR(key, () => fetchCuple(endpoint, options as any), {
    shouldRetryOnError: notAborted,
    ...swrConfig,
  });
}

/**
 * `useCuple`, with non-success results surfaced as `error` instead of `data`.
 *
 * It wraps `useCuple` rather than replacing the fetcher, so both hooks share one
 * cache entry: the union is what gets cached, and this only changes how it is
 * read. Nothing is fetched twice, and a component on `useCuple` with the same
 * key is unaffected.
 *
 * SWR never threw, so its retry and `onError` stay out of it — right for a 404,
 * which no amount of retrying will fix. Transport failures still reject out of
 * `fetchCuple`, so those keep SWR's backoff.
 */
export function useCupleSuccess<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  options: CupleOptions<TEndpoint>,
  swrConfig?: SWRConfiguration,
) {
  const { data, error, ...rest } = useCuple(endpoint, options, swrConfig);
  const failure =
    data && data.result !== "success"
      ? new CupleUnexpectedResponseError(data)
      : undefined;

  // Suspense renders errors at the boundary, and SWR only throws the ones it
  // raised itself. Without this a network failure reaches the boundary and a
  // `notFound` quietly does not.
  if (swrConfig?.suspense && failure) throw failure;

  return {
    ...rest,
    data:
      data?.result === "success"
        ? (data as Extract<CupleResult<TEndpoint>, { result: "success" }>)
        : undefined,
    error: (error ?? failure) as unknown,
  };
}

/**
 * `trigger(options)` resolves to the Cuple result union — every API failure is a
 * value, so check `result` instead of catching. Only a network failure rejects.
 */
export function useCupleMutation<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  swrConfig?: SWRMutationConfiguration<
    CupleResult<TEndpoint>,
    Error,
    readonly unknown[],
    CupleArgs<TEndpoint>
  >,
) {
  // Query options are always an object, so this sentinel can't collide with one.
  const key = cupleRequestKey(endpoint, "mutation");

  return useSWRMutation(
    key,
    (_key, { arg }: { arg: CupleArgs<TEndpoint> }) => fetchCuple(endpoint, arg as any),
    swrConfig,
  );
}

export function useCupleCache() {
  const { mutate } = useSWRConfig();

  return {
    /** One call with `options`, otherwise every cached call of the endpoint. */
    revalidate<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options?: CupleArgs<TEndpoint>,
    ) {
      if (options !== undefined) return mutate(cupleRequestKey(endpoint, options));

      const [endpointKey, principal] = cupleRequestKey(endpoint, undefined);
      const isThisEndpoint = (key: unknown): key is readonly unknown[] =>
        Array.isArray(key) && key[0] === endpointKey;

      // Other principals are evicted, not refetched: a refetch would use the
      // current credential and write the result into their bucket.
      return mutate((key) => isThisEndpoint(key) && key[1] === principal).then(() =>
        mutate((key) => isThisEndpoint(key) && key[1] !== principal, undefined, {
          revalidate: false,
        }),
      );
    },

    /** Writes the cache without refetching. */
    setCache<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options: CupleArgs<TEndpoint>,
      data: CupleResult<TEndpoint>,
      revalidate = false,
    ) {
      return mutate(cupleRequestKey(endpoint, options), data, { revalidate });
    },

    /** Shows `update` at once, runs `action`, refetches. Rolls back on throw. */
    optimistic<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options: CupleArgs<TEndpoint>,
      update: (current?: CupleResult<TEndpoint>) => CupleResult<TEndpoint>,
      action: () => Promise<unknown>,
    ) {
      return mutate(
        cupleRequestKey(endpoint, options),
        async () => {
          await action();
          return undefined;
        },
        {
          optimisticData: update as any,
          // `action`'s response has a different shape than the query's.
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    },
  };
}
