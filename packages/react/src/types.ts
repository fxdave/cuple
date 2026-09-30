import type {
  ClientEndpointRef,
  FetchCupleArgs,
  TransportErrorResult,
} from "@cuple/client";
import type { CupleConfig } from "./config";

/**
 * Composes several fetches into one cached value. Made by {@link combine}.
 *
 * Its identity is its cache identity, so create it once, at module level —
 * never inside a component.
 */
export type Combined<TArgs, TValue> = {
  readonly kind: "cuple-combined";
  /** For debugging only: the order combined reads were created in. */
  readonly id: number;
  readonly load: (context: CombineContext, args: TArgs) => Promise<TValue>;
};

/**
 * An endpoint read with GET. Reads never write: a POST, PUT, PATCH or DELETE
 * endpoint can't be read (it would run on every render, refresh and poll).
 * For a POST that only reads — a search, a quote — use {@link combine} with
 * `fetchCuple` inside.
 */
export type GetEndpoint = ClientEndpointRef & { tMethod: "get" };

/**
 * A client route, standing for its GET endpoint: `client.getNotes` reads as
 * `client.getNotes.get`. Writing `.get` out works too; both are the same call.
 */
export type Route = { get: GetEndpoint };

/**
 * Anything that can be read and cached: an endpoint, a {@link Route}, or a
 * {@link Combined} read.
 */
export type Readable = GetEndpoint | Route | Combined<any, any>;

/** What a readable reads: a route's GET endpoint, anything else itself. */
export type Target<R extends Readable> = R extends {
  get: infer E extends ClientEndpointRef;
}
  ? E
  : R;

/** The arguments a readable takes: the endpoint's input, or the combined read's `args`. */
export type ReadableArgs<R extends Readable> =
  Target<R> extends Combined<infer TArgs, any>
    ? TArgs
    : Target<R> extends ClientEndpointRef
      ? FetchCupleArgs<Target<R>>[0]
      : never;

type EndpointResult<R extends ClientEndpointRef> = R["tOutput"]["result"];

/** What a read can list: its endpoint's results, and `"transport-error"` for a network failure. */
type Listable<R extends ClientEndpointRef> = EndpointResult<R> | "transport-error";

/**
 * How a read treats non-success results. Only one of the two may be given.
 *
 * - neither: success only; anything else throws to the nearest `<Boundary>`
 * - `resolveAlso`: success, plus the listed results as values
 * - `resolveOn`: exactly the listed results — `"success"` is not implied
 */
export type ResolveOptions<R extends Readable> =
  Target<R> extends ClientEndpointRef
    ?
        | { resolveAlso?: readonly Listable<Target<R>>[]; resolveOn?: never }
        | { resolveOn?: readonly Listable<Target<R>>[]; resolveAlso?: never }
    : { resolveAlso?: never; resolveOn?: never };

export type ReadOptions<R extends Readable> = ResolveOptions<R> & {
  /** This read's settings, over the `<Boundary>`'s and the provider's. */
  config?: CupleConfig;
};

type Listed<O, K extends string> = O extends { [P in K]: readonly (infer T)[] }
  ? T
  : never;

/** What a read returns, given its options. */
export type ReadValue<R extends Readable, O = {}> =
  Target<R> extends Combined<any, infer TValue>
    ? TValue
    : Target<R> extends ClientEndpointRef
      ? O extends { resolveOn: readonly unknown[] }
        ? Extract<
            Target<R>["tOutput"] | TransportErrorResult,
            { result: Listed<O, "resolveOn"> }
          >
        : Extract<
            Target<R>["tOutput"] | TransportErrorResult,
            { result: "success" | Listed<O, "resolveAlso"> }
          >
      : never;

/** `[args]`, optional when the readable needs no input. */
export type ArgsTuple<R extends Readable> =
  undefined extends ReadableArgs<R>
    ? [args?: ReadableArgs<R>]
    : {} extends ReadableArgs<R>
      ? [args?: ReadableArgs<R>]
      : [args: ReadableArgs<R>];

/** `[args, options]`, with `args` optional when the readable needs no input. */
export type ReadRest<R extends Readable, O> = [...ArgsTuple<R>, options?: O];

/** Handed to a combined read's function. */
export type CombineContext = {
  /**
   * Reads through the cache, like `useGet` — shared with every other reader
   * of the same call. Success only unless `resolveOn`/`resolveAlso` says
   * otherwise; anything else rejects, and the combined read with it.
   *
   * Reading through `get` is also what lets a refresh of an endpoint re-run
   * this combined read. A plain `fetchCuple` inside a combined read works, but is invisible
   * to refresh.
   */
  get<R extends Readable, const O extends ResolveOptions<R> = ResolveOptions<R>>(
    readable: R,
    ...rest: ReadRest<R, O>
  ): Promise<ReadValue<R, O>>;
};
