import {
  type ClientSSEEndpointRef,
  CupleTransportError,
  CupleUnexpectedResponseError,
  cupleRequestKey,
  type FetchCupleSSEArgs,
  fetchCupleSSE,
} from "@cuple/client";
import { useEffect, useReducer, useRef, useState } from "react";
import { useCupleContext } from "./provider";
import { stableStringify } from "./share";

/** The event type an SSE endpoint yields, taken from its server definition. */
export type StreamEvent<TEndpoint extends ClientSSEEndpointRef> =
  Extract<TEndpoint["tOutput"], AsyncIterable<unknown>> extends AsyncIterable<
    infer TEvent
  >
    ? TEvent
    : never;

/**
 * Subscribes to an SSE endpoint and hands you each event as it arrives.
 *
 * ```tsx
 * useStream(client.orderEvents.get, {}, (event) => {
 *   store.refresh([client.getOrders]); // someone else changed orders
 * });
 * ```
 *
 * The hook owns the connection: it opens it, closes it on unmount, and opens
 * it again when the args change. Events are not stored — what to keep, or what
 * to refresh, is yours to decide.
 *
 * - A rejected connection (the middleware answered `unauthorized`, say) throws
 *   to the nearest `<Boundary>`, like a failed read.
 * - A network failure is kept as `error`, with `isStreaming: false`: streams
 *   drop, and the page should stay. Call `reconnect()` to try again.
 *
 * To stream only sometimes, render the component only sometimes.
 */
export function useStream<TEndpoint extends ClientSSEEndpointRef>(
  endpoint: TEndpoint,
  args: FetchCupleSSEArgs<TEndpoint>[0],
  onEvent: (event: StreamEvent<TEndpoint>) => void,
) {
  const [state, setState] = useState<{
    isStreaming: boolean;
    error?: CupleTransportError;
  }>({ isStreaming: true });
  const [attempt, reconnect] = useReducer((n: number) => n + 1, 0);
  // After `store.refreshKeys()`, render again: the key below may have changed,
  // and a changed key reconnects.
  const { store } = useCupleContext();
  const [, rekey] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const stop = store.subscribeKeys(rekey);
    return () => {
      stop();
    };
  }, [store]);
  const [, throwToBoundary] = useState<never>();

  // A client proxy is rebuilt on every property access, so the endpoint, args
  // and callback are read through a ref; the key covers their identity.
  const key = stableStringify(cupleRequestKey(endpoint, args));
  const latest = useRef({ endpoint, args, onEvent });
  latest.current = { endpoint, args, onEvent };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reopens on purpose
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState({ isStreaming: true });

    void (async () => {
      const { endpoint, args } = latest.current;
      try {
        const options = [
          { ...args, options: { ...args?.options, signal: controller.signal } },
        ] as unknown as FetchCupleSSEArgs<TEndpoint>;
        const result = await fetchCupleSSE(endpoint, ...options).thenResolveAll();

        // A rejection arrives as a JSON result instead of a stream.
        if (result.result !== "success") {
          if (live)
            throwToBoundary(() => {
              throw new CupleUnexpectedResponseError(result);
            });
          return;
        }

        const stream: AsyncIterable<StreamEvent<TEndpoint>> = result;
        for await (const event of stream) {
          if (!live) break;
          latest.current.onEvent(event);
        }
        if (live) setState({ isStreaming: false });
      } catch (error) {
        if (!live || (error as { name?: string })?.name === "AbortError") return;
        if (error instanceof CupleTransportError) {
          setState({ isStreaming: false, error });
        } else {
          throwToBoundary(() => {
            throw error;
          });
        }
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [key, attempt]);

  return { ...state, reconnect };
}
