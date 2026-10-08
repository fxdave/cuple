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

it("serves what the combine examples read", async () => {
  const deleted = await fetchCuple(client.getCustomer.get, {
    params: { id: 2 },
  }).thenKeep(["success", "customer-not-found"]);
  expect(deleted.result).toBe("customer-not-found");

  const { products } = await fetchCuple(client.searchProducts.post, {
    body: { q: "LAP" },
  }).thenKeepSuccess();
  expect(products).toEqual(["Laptop", "Laptop stand"]);

  const first = await fetchCuple(client.getNotes.get, { query: {} }).thenKeepSuccess();
  const second = await fetchCuple(client.getNotes.get, {
    query: { cursor: first.nextCursor ?? undefined },
  }).thenKeepSuccess();
  const last = await fetchCuple(client.getNotes.get, {
    query: { cursor: second.nextCursor ?? undefined },
  }).thenKeepSuccess();
  expect([first, second, last].flatMap((page) => page.notes).map((n) => n.id)).toEqual([
    1, 2, 3, 4, 5, 6, 7,
  ]);
  expect(last.nextCursor).toBeNull();
});
