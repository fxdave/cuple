import { createClient } from "@cuple/client";
import type { routes } from "../backend";

export const client = createClient<typeof routes>({ path: "/rpc" });
