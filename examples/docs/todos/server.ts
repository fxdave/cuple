import { createBuilder, initRpc, success, zodValidationError } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
if (!process.env.VITEST) {
  // Slow enough to see the optimistic toggle happen before the server answers.
  app.use((_req, _res, next) => setTimeout(next, 1000));
  app.listen(3002, () => console.log("Todo API on http://localhost:3002/rpc"));
}
const builder = createBuilder(app);

export type Todo = { id: number; text: string; done: boolean };
let todos: Todo[] = [];

// #region routes
export const routes = {
  getTodos: builder.get(async () => success({ todos })),

  createTodo: builder
    .bodySchema(z.object({ text: z.string().min(1, "Write something first.") }))
    .post(async ({ data }) => {
      if (todos.some((todo) => todo.text === data.body.text)) {
        return zodValidationError([
          { code: "custom", path: ["text"], message: "You already have this todo." },
        ]);
      }
      const todo = { id: todos.length + 1, text: data.body.text, done: false };
      todos.push(todo);
      return success({ todo });
    }),

  toggleTodo: builder
    .paramsSchema(z.object({ id: z.number() }))
    .patch(async ({ data }) => {
      const todo = todos.find((todo) => todo.id === data.params.id)!;
      todo.done = !todo.done;
      return success({ todo });
    }),

  clearCompleted: builder.post(async () => {
    todos = todos.filter((todo) => !todo.done);
    return success({});
  }),
};
// #endregion

initRpc(app, { path: "/rpc", routes });
