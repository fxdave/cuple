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

it("finds products by part of their name, ignoring case", async () => {
  const { products } = await fetchCuple(client.searchProducts.get, {
    query: { q: "MONITOR" },
  }).thenKeepSuccess();
  expect(products.map((product) => product.name)).toEqual(["Monitor", "Monitor arm"]);
});
