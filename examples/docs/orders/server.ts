import { createBuilder, initRpc, notFound, success } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
if (!process.env.VITEST) {
  // Slow enough to see what loads when.
  app.use((_req, _res, next) => setTimeout(next, 600));
  app.listen(3002, () => console.log("Orders API on http://localhost:3002/rpc"));
}
const builder = createBuilder(app);

const customers = [
  { id: 1, name: "Ada Lovelace", email: "ada@example.com" },
  { id: 2, name: "Linus Torvalds", email: "linus@example.com" },
];
const orders = [
  { id: 101, item: "Standing desk", customerId: 1 },
  { id: 102, item: "Mechanical keyboard", customerId: 2 },
  { id: 103, item: "Monitor arm", customerId: 1 },
];

// #region routes
export const routes = {
  getOrders: builder.get(async () => success({ orders })),

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
};
// #endregion

initRpc(app, { path: "/rpc", routes });
