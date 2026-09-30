import { createClient } from "@cuple/client";
import type { routes } from "./server";

export const client = createClient<typeof routes>({ path: "/rpc" });
