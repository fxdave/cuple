/**
 * `next`, but reusing every part of `prev` that is deep-equal to it, so a
 * refresh that changed nothing keeps object identity and nothing re-renders.
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (Array.isArray(prev) && Array.isArray(next)) {
    const items = next.map((item, i) => share(prev[i], item));
    const same =
      prev.length === next.length && items.every((item, i) => item === prev[i]);
    return (same ? prev : items) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next);
    const merged: Record<string, unknown> = {};
    let same = keys.length === Object.keys(prev).length;
    for (const key of keys) {
      merged[key] = share(prev[key], next[key]);
      if (merged[key] !== prev[key] || !(key in prev)) same = false;
    }
    return (same ? prev : merged) as T;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** JSON with sorted keys, so `{ a, b }` and `{ b, a }` are the same cache key. */
export function stableStringify(value: unknown): string {
  return (
    JSON.stringify(value, (_key, val) =>
      isPlainObject(val)
        ? Object.fromEntries(
            Object.keys(val)
              .sort()
              .map((k) => [k, val[k]]),
          )
        : val,
    ) ?? "undefined"
  );
}
