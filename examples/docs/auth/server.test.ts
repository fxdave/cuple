import { once } from "node:events";
import { createClient, fetchCuple } from "@cuple/client";
import { afterAll, expect, it } from "vitest";
import { app, type routes } from "./server";

const http = app.listen(0);
await once(http, "listening");
afterAll(() => http.close());
const client = createClient<typeof routes>({
  path: `http://localhost:${(http.address() as { port: number }).port}/rpc`,
});

it("answers 401 once the session is gone", async () => {
  const { token } = await fetchCuple(client.signIn.post, { body: { name: "Ada" } });
  const headers = { authorization: token };
  const { greeting } = await fetchCuple(client.getGreeting.get, { headers });
  expect(greeting).toBe("Hello, Ada!");

  await fetchCuple(client.expireSession.post, { headers });
  const expired = await fetchCuple(client.getGreeting.get, { headers }).thenResolveAlso([
    "session-expired",
  ]);
  expect(expired).toMatchObject({ result: "session-expired", statusCode: 401 });
});
