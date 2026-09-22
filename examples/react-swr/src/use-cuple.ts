import { type ClientEndpointRef, type FetchCupleArgs, fetchCuple } from "@cuple/client";
import useSWR, { type SWRConfiguration, useSWRConfig } from "swr";
import useSWRMutation, { type SWRMutationConfiguration } from "swr/mutation";

type CupleArgs<TEndpoint extends ClientEndpointRef> = FetchCupleArgs<TEndpoint>[0];

type CupleOptions<TEndpoint extends ClientEndpointRef> = CupleArgs<TEndpoint> | null;

type CupleResult<TEndpoint extends ClientEndpointRef> = Awaited<
  ReturnType<typeof fetchCuple<TEndpoint>>
>;

/**
 * The SWR cache key of an endpoint call. Same endpoint + same options means
 * the same key, so this is what you hand to `mutate` to revalidate a query.
 */
export function cupleKey<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  options: CupleArgs<TEndpoint>,
) {
  const { path, segments, method } = endpoint.clientProps;
  return [path, ...segments, method, options] as const;
}

/** True for every cache key belonging to `endpoint`, whatever its options. */
function keyBelongsTo(endpoint: ClientEndpointRef, key: unknown) {
  const { path, segments, method } = endpoint.clientProps;
  const prefix = [path, ...segments, method];
  return (
    Array.isArray(key) &&
    key.length === prefix.length + 1 &&
    prefix.every((part, i) => key[i] === part)
  );
}

export function useCuple<TEndpoint extends ClientEndpointRef>(
  endpoint: TEndpoint,
  options: CupleOptions<TEndpoint>,
  swrConfig?: SWRConfiguration,
) {
  const key = options !== null ? cupleKey(endpoint, options) : null;

  return useSWR(key, () => fetchCuple(endpoint, options as any), swrConfig);
}

/**
 * Calls a write endpoint and gives you the SWR mutation state around it.
 *
 * `trigger(options)` takes the same options object as `fetchCuple`, and
 * resolves to the usual Cuple discriminated union — a `notFound` result is a
 * value, not a thrown error, so check `result` instead of catching.
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
  const { path, segments, method } = endpoint.clientProps;
  // Distinct from the query key, so a mutation never overwrites a cached read.
  const key = [path, ...segments, method, "mutation"] as const;

  return useSWRMutation(
    key,
    (_key, { arg }: { arg: CupleArgs<TEndpoint> }) => fetchCuple(endpoint, arg as any),
    swrConfig,
  );
}

/**
 * Revalidation helpers, for use after a mutation succeeds.
 *
 * - `revalidate(endpoint)` refetches every cached call of that endpoint.
 * - `revalidate(endpoint, options)` refetches just that one call.
 * - `setCache(endpoint, options, data)` writes the cache without a refetch.
 * - `optimistic(endpoint, options, update, action)` shows `update` right away,
 *   runs `action`, then refetches — rolling back if `action` throws.
 */
export function useCupleCache() {
  const { mutate } = useSWRConfig();

  return {
    revalidate<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options?: CupleArgs<TEndpoint>,
    ) {
      if (options === undefined) return mutate((key) => keyBelongsTo(endpoint, key));
      return mutate(cupleKey(endpoint, options));
    },

    setCache<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options: CupleArgs<TEndpoint>,
      data: CupleResult<TEndpoint>,
      revalidate = false,
    ) {
      return mutate(cupleKey(endpoint, options), data, { revalidate });
    },

    optimistic<TEndpoint extends ClientEndpointRef>(
      endpoint: TEndpoint,
      options: CupleArgs<TEndpoint>,
      update: (current?: CupleResult<TEndpoint>) => CupleResult<TEndpoint>,
      action: () => Promise<unknown>,
    ) {
      return mutate(
        cupleKey(endpoint, options),
        async () => {
          await action();
          return undefined;
        },
        {
          optimisticData: update as any,
          // The action's own response has a different shape than the query's,
          // so drop it and let the revalidation below refill the cache.
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );
    },
  };
}
