import { once } from "node:events";
import { createClient, fetchCuple } from "@cuple/client";
import { afterAll, expect, it } from "vitest";
import { app, type routes } from "./server";

const http = app.listen(0);
await once(http, "listening");
afterAll(() => http.close());
const client = createClient<typeof routes>({
  path: `http://localhost:${(http.address() as { port: number }).port}/rpc`,
});

it("serves an order, and the customer it points to", async () => {
  const { order } = await fetchCuple(client.getOrder.get, {
    params: { id: 101 },
  }).thenKeepSuccess();
  const { customer } = await fetchCuple(client.getCustomer.get, {
    params: { id: order.customerId },
  }).thenKeepSuccess();
  expect(customer.name).toBe("Ada Lovelace");
  const missing = await fetchCuple(client.getOrder.get, {
    params: { id: 999 },
  }).thenKeep(["success", "order-not-found"]);
  expect(missing.result).toBe("order-not-found");
});
