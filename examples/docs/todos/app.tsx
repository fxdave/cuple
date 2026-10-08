import { fetchCuple } from "@cuple/client";
import { Boundary, CupleProvider, useAction, useGet } from "@cuple/react";
import { useState } from "react";
import { client, store } from "./client";
import type { Todo } from "./server";

// #region setup
export function App() {
  return (
    <CupleProvider store={store}>
      <Boundary
        fallback={<TodoListSkeleton />}
        error={(error, retry) => (
          <p>
            {error.message}{" "}
            <button type="button" onClick={retry}>
              Retry
            </button>
          </p>
        )}
      >
        <TodoList />
      </Boundary>
    </CupleProvider>
  );
}
// #endregion

// #region todo-list
function TodoList() {
  const { todos } = useGet(client.getTodos);

  return (
    <>
      <NewTodo />
      <ul>
        {todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} />
        ))}
      </ul>
      <ClearCompleted />
    </>
  );
}
// #endregion

// #region new-todo
function NewTodo() {
  const [text, setText] = useState("");
  const create = useAction(
    async (text: string) => {
      const response = await fetchCuple(client.createTodo.post, {
        body: { text },
      }).thenKeep(["success", "invalid-body"]);
      if (response.result === "success") setText("");
      return response;
    },
    { refresh: { success: [client.getTodos] } },
  );

  const issue =
    create.value?.result === "invalid-body"
      ? create.value.issues.find((issue) => issue.path[0] === "text")
      : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.run(text);
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={create.isPending}
        aria-busy={create.isPending}
      />
      {issue && <p className="error">{issue.message}</p>}
    </form>
  );
}
// #endregion

// #region todo-item
function TodoItem({ todo }: { todo: Todo }) {
  const toggle = useAction(
    () =>
      fetchCuple(client.toggleTodo.patch, {
        params: { id: todo.id },
      }).thenKeepSuccess(),
    { refresh: [client.getTodos] },
  );

  return (
    <li className={toggle.isPending ? "pending" : undefined} aria-busy={toggle.isPending}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => toggle.run()}
        disabled={toggle.isPending}
      />{" "}
      {todo.text}
    </li>
  );
}
// #endregion

// #region clear-completed
function ClearCompleted() {
  const clear = useAction(
    () => fetchCuple(client.clearCompleted.post).thenKeepSuccess(),
    {
      refresh: [client.getTodos],
    },
  );

  return (
    <button
      type="button"
      disabled={clear.isPending}
      aria-busy={clear.isPending}
      onClick={() => clear.run()}
    >
      Clear completed
    </button>
  );
}
// #endregion

/** Shaped like the list, so nothing jumps when the todos land. */
function TodoListSkeleton() {
  return (
    <ul role="status" aria-busy="true" aria-label="Loading todos">
      <li className="skeleton" style={{ width: "60%" }} />
      <li className="skeleton" style={{ width: "45%" }} />
      <li className="skeleton" style={{ width: "70%" }} />
    </ul>
  );
}
