import { randomUUID } from "node:crypto";
import { createBuilder, initRpc, success, unauthorized } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
if (!process.env.VITEST) {
  app.listen(3002, () => console.log("Auth API on http://localhost:3002/rpc"));
}
const builder = createBuilder(app);

/** token → user name. Restarting the server signs everyone out. */
const sessions = new Map<string, string>();

// #region auth-link
const signedIn = builder
  .headersSchema(z.looseObject({ authorization: z.string() }))
  .middleware(async ({ data }) => {
    const user = sessions.get(data.headers.authorization);
    if (!user)
      return {
        next: false as const,
        ...unauthorized({ result: "session-expired", message: "Please sign in again." }),
      };
    return { next: true as const, user };
  })
  .buildLink();
// #endregion

export const routes = {
  signIn: builder
    .bodySchema(z.strictObject({ name: z.string().min(1, "Enter your name.") }))
    .post(async ({ data }) => {
      const token = randomUUID();
      sessions.set(token, data.body.name);
      return success({ token });
    }),

  getGreeting: builder
    .chain(signedIn)
    .get(async ({ data }) => success({ greeting: `Hello, ${data.user}!` })),

  /** Ends the session on the server only, as an expiry would. */
  expireSession: builder.chain(signedIn).post(async ({ data }) => {
    sessions.delete(data.headers.authorization);
    return success({});
  }),
};

initRpc(app, { path: "/rpc", routes });
