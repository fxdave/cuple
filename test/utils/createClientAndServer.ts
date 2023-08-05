import express from "express";
import { Client, createClient, RecursiveApi } from "../../src/client";
import { createBuilder, initRpc } from "../../src/server";
import { Builder } from "../../src/server/builder";

export default async function createClientAndServer<T extends RecursiveApi>(
  createRoutes: (builder: Builder<object, unknown, "post">) => T
) {
  const app = express();
  const builder = createBuilder(app);
  const routes = createRoutes(builder);

  initRpc(app, {
    path: "/rpc",
    routes,
  });

  const client = createClient<typeof routes>({
    path: "http://localhost:8080/rpc",
  });

  function run(cb: (client: Client<T, {}>) => Promise<void>) {
    return new Promise((resolve, reject) => {
      let server = app.listen(8080, () => {
        cb(client)
          .then((val) => {
            server.close();
            resolve(val);
          })
          .catch((e) => {
            server.close();
            reject(e);
          });
      });
    });
  }

  return {
    run,
  };
}
