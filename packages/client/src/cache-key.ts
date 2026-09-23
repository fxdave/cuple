import type { ClientEndpointRef, ClientSSEEndpointRef } from "./client";

type AnyEndpointRef = ClientEndpointRef | ClientSSEEndpointRef;

/** Identifies the route. JSON, not a joined string, because `path` is a URL. */
export function cupleEndpointKey(endpoint: AnyEndpointRef): string {
  const { path, segments, method } = endpoint.clientProps;
  return JSON.stringify([path, ...segments, method]);
}

/**
 * Cache key of one call: `[endpointKey, principal, input]`.
 *
 * `with({ middleware })` runs per request and what it returns never reaches the
 * key, so a client serving more than one user needs `with({ key })` to keep
 * their responses apart.
 *
 * `options` (the `RequestInit`) is left out. It is transport configuration, not
 * request identity — the server never sees it — and it tends to hold values
 * like an `AbortSignal` that caches hash by identity, which would make the key
 * change on every render. Two calls differing only in `credentials` or `cache`
 * therefore share an entry; give them different `with({ key })` if that matters.
 */
export function cupleRequestKey(endpoint: AnyEndpointRef, args: unknown) {
  const { key } = endpoint.clientProps;
  const principal = (typeof key === "function" ? key() : key) ?? "";
  let input = args;
  if (args !== null && typeof args === "object") {
    const { options: _options, ...rest } = args as Record<string, unknown>;
    input = rest;
  }
  return [cupleEndpointKey(endpoint), principal, input] as const;
}
