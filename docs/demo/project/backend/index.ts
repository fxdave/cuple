import express from "express";
import { createBuilder, initRpc, success } from "@cuple/server";

const app = express();
const builder = createBuilder(app);

export const routes = {
  sayHi: builder
    .get(async () => {
      return success({ message: "Hi!" });
    }),
};

initRpc(app, { path: "/rpc", routes });
app.listen(3001);
