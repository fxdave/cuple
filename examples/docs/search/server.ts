import { createBuilder, initRpc, success } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
if (!process.env.VITEST) {
  // Slow enough to see the old results stay while the new ones load.
  app.use((_req, _res, next) => setTimeout(next, 600));
  app.listen(3002, () => console.log("Search API on http://localhost:3002/rpc"));
}
const builder = createBuilder(app);

const products = [
  "Laptop",
  "Laptop stand",
  "Lamp",
  "Keyboard",
  "Mouse",
  "Monitor",
  "Monitor arm",
].map((name, i) => ({ id: i + 1, name }));

// #region routes
export const routes = {
  searchProducts: builder
    .querySchema(z.strictObject({ q: z.string() }))
    .get(async ({ data }) => {
      const q = data.query.q.toLowerCase();
      return success({
        products: products.filter((product) => product.name.toLowerCase().includes(q)),
      });
    }),
};
// #endregion

initRpc(app, { path: "/rpc", routes });
