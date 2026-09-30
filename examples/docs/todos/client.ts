import { createClient } from "@cuple/client";
import { createCupleStore } from "@cuple/react";
import type { routes } from "./server";

// #region setup
export const client = createClient<typeof routes>({ path: "/rpc" });
export const store = createCupleStore();
// #endregion
