import {
  type ClientEndpointRef,
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

/** Null options suspends the fetch. */
export function useCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  options: CupleOptions<TEndpoint>,
  swrConfig?: SWRConfiguration,
) {
  const key = options !== null ? cupleRequestKey(endpoint, options) : null;

  return useSWR(key, () => fetchCuple(endpoint, options as any), swrConfig);
}

/**
 * `trigger(options)` resolves to the Cuple result union — a `notFound` is a
 * value, not a throw, so check `result` instead of catching.
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
