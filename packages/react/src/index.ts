/**
 * Reads, actions and a cache for React 19, built on `fetchCuple`.
 *
 * @packageDocumentation
 */
export { Boundary, useIsFetching } from "./boundary";
export { combine } from "./combine";
export type { CupleConfig, ErrorRoute, OnError } from "./config";
export { type CupleError, toCupleError } from "./errors";
export { CupleProvider } from "./provider";
export { type CupleStore, createCupleStore } from "./store";
export type {
  CombineContext,
  Combined,
  GetEndpoint,
  Readable,
  ReadableArgs,
  ReadOptions,
  ReadValue,
  ResolveOptions,
  Route,
  Target,
} from "./types";
export {
  type Action,
  type ActionOptions,
  type ActionState,
  useAction,
} from "./use-action";
export { useGet } from "./use-get";
export { usePages } from "./use-pages";
export { type StreamEvent, useStream } from "./use-stream";
