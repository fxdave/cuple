import type { ClientEndpointRef, ClientSSEEndpointRef } from "./client";

type AnyEndpointRef = ClientEndpointRef | ClientSSEEndpointRef;

/** Identifies the route. JSON, not a joined string, because `path` is a URL. */
export function cupleEndpointKey(endpoint: AnyEndpointRef): string {
  const { path, segments, method } = endpoint.clientProps;
  return JSON.stringify([path, ...segments, method]);
}

/**
 * Cache key of one call: `[endpointKey, principal, options]`.
 *
 * `with({ middleware })` runs per request and what it returns never reaches the
 * key, so a client serving more than one user needs `with({ key })` to keep
 * their responses apart.
 */
export function cupleRequestKey(endpoint: AnyEndpointRef, options: unknown) {
  const { key } = endpoint.clientProps;
  const principal = (typeof key === "function" ? key() : key) ?? "";
  return [cupleEndpointKey(endpoint), principal, options] as const;
}
