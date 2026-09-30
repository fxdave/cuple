import { createClient } from "@cuple/client";
import { createCupleStore } from "@cuple/react";
import type { routes } from "./server";

export const client = createClient<typeof routes>({ path: "/rpc" });
export const store = createCupleStore();
