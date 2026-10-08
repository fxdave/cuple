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

it("works as the docs describe it", async () => {
  const empty = await fetchCuple(client.createTodo.post, {
    body: { text: "" },
  }).thenKeep(["success", "invalid-body"]);
  expect(empty).toMatchObject({
    result: "invalid-body",
    issues: [{ path: ["text"], message: "Write something first." }],
  });

  await fetchCuple(client.createTodo.post, { body: { text: "Milk" } });
  const duplicate = await fetchCuple(client.createTodo.post, {
    body: { text: "Milk" },
  }).thenKeep(["success", "invalid-body"]);
  expect(duplicate).toMatchObject({
    issues: [{ path: ["text"], message: "You already have this todo." }],
  });

  const { todo } = await fetchCuple(client.toggleTodo.patch, {
    params: { id: 1 },
  }).thenKeepSuccess();
  expect(todo.done).toBe(true);

  await fetchCuple(client.clearCompleted.post);
  expect((await fetchCuple(client.getTodos.get).thenKeepSuccess()).todos).toEqual([]);
});
