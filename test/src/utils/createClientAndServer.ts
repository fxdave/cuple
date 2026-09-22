import { Server } from "node:http";
import { type Client, createClient, type RecursiveApi } from "@cuple/client";
import { type Builder, createBuilder, initRpc } from "@cuple/server";
import express from "express";

export default async function createClientAndServer<T extends RecursiveApi>(
  createRoutes: (builder: Builder) => T,
  builderOptions?: Parameters<typeof createBuilder>[1],
) {
  const app = express();
  const builder = createBuilder(app, builderOptions);
  const routes = createRoutes(builder);

  initRpc(app, {
    path: "/rpc",
    routes,
  });

  function run(
    cb: (client: Client<T, NonNullable<unknown>>, url: string) => Promise<void>,
  ) {
    return new Promise((resolve, reject) => {
      // Listen on port 0 to get an available port
      const server = app.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Failed to get server address"));
          return;
        }

        const port = address.port;

        // Create client with the dynamically assigned port
        const client = createClient<typeof routes>({
          path: `http://localhost:${port}/rpc`,
        });

        cb(client, `http://localhost:${port}`)
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
