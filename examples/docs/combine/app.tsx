import { fetchCuple } from "@cuple/client";
import { Boundary, CupleProvider, combine, useGet } from "@cuple/react";
import { useState, useTransition } from "react";
import { client, store } from "./client";

// #region parallel
/** Two independent reads at once: the page waits for both, not one after the other. */
export const loadDashboard = combine(async (ctx) => {
  const [stats, latest] = await Promise.all([
    ctx.get(client.getStats),
    ctx.get(client.getLatestOrders),
  ]);
  return { revenue: stats.revenue, orders: latest.orders };
});

function Dashboard() {
  const dashboard = useGet(loadDashboard);
  return (
    <p>{`Revenue: ${dashboard.revenue}, latest orders: ${dashboard.orders.length}`}</p>
  );
}
// #endregion

// #region dependent
/** The customer's id is in the order, so the second read waits for the first. */
export const loadOrderWithCustomer = combine(async (ctx, id: number) => {
  const { order } = await ctx.get(client.getOrder, { params: { id } });
  // A deleted customer is a normal outcome here: listed, it's a value, not an error.
  const customer = await ctx.get(
    client.getCustomer,
    { params: { id: order.customerId } },
    { resolveAlso: ["customer-not-found"] },
  );
  return {
    item: order.item,
    customerName:
      customer.result === "success" ? customer.customer.name : "Deleted customer",
  };
});

function Order({ id }: { id: number }) {
  const order = useGet(loadOrderWithCustomer, id);
  return <p>{`${order.item}, ordered by ${order.customerName}`}</p>;
}
// #endregion

// #region post-read
/** A POST that only reads, like a long search: wrapped, it reads and caches like a GET. */
export const searchProducts = combine(async (_ctx, q: string) => {
  const { products } = await fetchCuple(client.searchProducts.post, {
    body: { q },
  });
  return products;
});

function Search({ q }: { q: string }) {
  const products = useGet(searchProducts, q);
  return <p>{products.join(", ")}</p>;
}
// #endregion

// #region load-more
/** The first `count` pages: each page's cursor comes from the page before. */
export const loadNotes = combine(async (ctx, args: { count: number }) => {
  const pages = [];
  let cursor: number | null | undefined;
  while (cursor !== null && pages.length < args.count) {
    const page = await ctx.get(client.getNotes, { query: { cursor } });
    pages.push(page);
    cursor = page.nextCursor;
  }
  return {
    notes: pages.flatMap((page) => page.notes),
    hasMore: cursor !== null,
  };
});

function Notes() {
  const [count, setCount] = useState(1);
  const [isPending, startTransition] = useTransition();
  const list = useGet(loadNotes, { count });
  return (
    <>
      <ul>
        {list.notes.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
      </ul>
      {list.hasMore && (
        <button
          type="button"
          onClick={() => startTransition(() => setCount(count + 1))}
          disabled={isPending}
        >
          {isPending ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}
// #endregion

export function App() {
  return (
    <CupleProvider store={store}>
      <main>
        <Boundary fallback={<p>Loading…</p>}>
          <Dashboard />
          <Order id={101} />
          <Order id={102} />
          <Search q="lap" />
          <Notes />
        </Boundary>
      </main>
    </CupleProvider>
  );
}
