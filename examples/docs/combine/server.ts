import { createBuilder, initRpc, notFound, success } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
if (!process.env.VITEST) {
  // Slow enough to see what loads when.
  app.use((_req, _res, next) => setTimeout(next, 600));
  app.listen(3002, () => console.log("Combine API on http://localhost:3002/rpc"));
}
const builder = createBuilder(app);

const customers = [{ id: 1, name: "Ada Lovelace" }];
const orders = [
  { id: 101, item: "Standing desk", customerId: 1 },
  { id: 102, item: "Monitor arm", customerId: 2 }, // customer 2 was deleted
];
const products = ["Laptop", "Laptop stand", "Lamp", "Keyboard", "Monitor"];
const notes = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  title: `Note ${i + 1}`,
}));

// #region routes
export const routes = {
  getStats: builder.get(async () => success({ revenue: 1200, orders: orders.length })),

  getLatestOrders: builder.get(async () => success({ orders: orders.slice(-5) })),

  getOrder: builder
    .paramsSchema(z.strictObject({ id: z.number() }))
    .get(async ({ data }) => {
      const order = orders.find((order) => order.id === data.params.id);
      if (!order)
        return notFound({ result: "order-not-found", message: "No such order." });
      return success({ order });
    }),

  getCustomer: builder
    .paramsSchema(z.strictObject({ id: z.number() }))
    .get(async ({ data }) => {
      const customer = customers.find((customer) => customer.id === data.params.id);
      if (!customer)
        return notFound({ result: "customer-not-found", message: "No such customer." });
      return success({ customer });
    }),

  // A POST, because the query could be long. It only reads.
  searchProducts: builder
    .bodySchema(z.strictObject({ q: z.string() }))
    .post(async ({ data }) =>
      success({
        products: products.filter((p) =>
          p.toLowerCase().includes(data.body.q.toLowerCase()),
        ),
      }),
    ),

  getNotes: builder
    .querySchema(z.strictObject({ cursor: z.coerce.number().optional() }))
    .get(async ({ data }) => {
      const after = data.query.cursor ?? 0;
      const page = notes.filter((note) => note.id > after).slice(0, 3);
      const last = page[page.length - 1];
      const nextCursor = last && last.id < notes.length ? last.id : null;
      return success({ notes: page, nextCursor });
    }),
};
// #endregion

initRpc(app, { path: "/rpc", routes });
