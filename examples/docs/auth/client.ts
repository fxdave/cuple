import { createClient } from "@cuple/client";
import { createCupleStore } from "@cuple/react";
import type { routes } from "./server";

let token: string | null = null;
export const session = {
  get: () => token,
  set: (next: string | null) => {
    token = next;
  },
};

// #region clients
export const client = createClient<typeof routes>({ path: "/rpc" });

export const authedClient = client.with({
  middleware: () => ({ headers: { authorization: session.get() ?? "" } }),
  key: () => session.get() ?? "",
});
// #endregion

export const store = createCupleStore();
