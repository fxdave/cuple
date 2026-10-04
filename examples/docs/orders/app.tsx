import { Boundary, CupleProvider, combine, useGet } from "@cuple/react";
import { useState } from "react";
import { client, store } from "./client";

// #region combine
/** An order and the customer who placed it. The customer's id is in the order. */
export const loadOrderWithCustomer = combine({
  load: async (ctx, id: number) => {
    const { order } = await ctx.get(client.getOrder, { params: { id } });
    const { customer } = await ctx.get(client.getCustomer, {
      params: { id: order.customerId },
    });
    return { order, customer };
  },
});
// #endregion

export function App() {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <CupleProvider store={store}>
      <main>
        <h1>Orders</h1>
        <Boundary fallback={<p className="muted">Loading orders…</p>}>
          <OrderList onOpen={setOpenId} />
        </Boundary>
        {openId !== null && (
          <Boundary key={openId} fallback={<p className="muted">Loading order…</p>}>
            <OrderDetails id={openId} />
          </Boundary>
        )}
      </main>
    </CupleProvider>
  );
}

// #region order-list
function OrderList({ onOpen }: { onOpen: (id: number) => void }) {
  const { orders } = useGet(client.getOrders);
  return (
    <ul>
      {orders.map((order) => (
        <li key={order.id}>
          <button type="button" onClick={() => onOpen(order.id)}>
            {order.item}
          </button>{" "}
          <Boundary fallback={<span className="muted">…</span>}>
            <CustomerName id={order.customerId} />
          </Boundary>
        </li>
      ))}
    </ul>
  );
}

function CustomerName({ id }: { id: number }) {
  const { customer } = useGet(client.getCustomer, { params: { id } });
  return <span className="muted">{customer.name}</span>;
}
// #endregion

// #region order-details
function OrderDetails({ id }: { id: number }) {
  const { order, customer } = useGet(loadOrderWithCustomer, id);
  return (
    <article>
      <h2>{order.item}</h2>
      <p>
        Ordered by {customer.name} ({customer.email})
      </p>
    </article>
  );
}
// #endregion
