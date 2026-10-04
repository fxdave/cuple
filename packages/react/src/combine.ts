import type { CombineContext, Combined } from "./types";

let nextId = 0;

/**
 * Combines several fetches into one cached value, written as a plain async
 * function. Only needed for composition — a single endpoint is read directly.
 *
 * ```ts
 * export const loadOrderWithCustomer = combine({
 *   load: async (ctx, id: number) => {
 *     const { order } = await ctx.get(client.getOrder, { params: { id } });
 *     const { customer } = await ctx.get(client.getCustomer, { params: { id: order.customerId } });
 *     return { order, customer };
 *   },
 * });
 *
 * const { order, customer } = useGet(loadOrderWithCustomer, 5);
 * ```
 *
 * Create combined reads at module level: a combined read's identity is its cache identity,
 * so one created during render would never hit the cache.
 *
 * Args must be JSON: they are the cache key.
 */
export function combine<TArgs = undefined, TValue = unknown>(definition: {
  /** Computes the value from `args`, reading through `ctx.get`. */
  load: (ctx: CombineContext, args: TArgs) => Promise<TValue>;
}): Combined<TArgs, TValue> {
  return { kind: "cuple-combined", id: nextId++, load: definition.load };
}

export function isCombined(value: unknown): value is Combined<unknown, unknown> {
  return (value as { kind?: unknown } | null)?.kind === "cuple-combined";
}
