import { createClient, fetchCuple } from "@cuple/client";
import { Boundary, useAction, useGet } from "@cuple/react";
import { mockCuple, renderWithCuple } from "@cuple/react/testing";
import { createBuilder, success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Only the types of these routes are used: tests with mockCuple never start a server.
const builder = createBuilder(express());
const routes = {
  getTodos: builder.get(async () => success({ todos: ["milk"] })),
  getTodo: builder
    .paramsSchema(z.object({ id: z.number() }))
    .get(async ({ data }) => success({ id: data.params.id, text: "milk" })),
  admin: {
    stats: builder.get(async () => success({ count: 1 })),
  },
  addTodo: builder
    .bodySchema(z.object({ text: z.string() }))
    .post(async ({ data }) => success({ text: data.body.text })),
};
const client = createClient<typeof routes>({ path: "http://mocked.test/rpc" });

afterEach(() => vi.unstubAllGlobals());

function Todos() {
  const { todos } = useGet(client.getTodos.get);
  return <p>{`todos: ${todos.join(", ")}`}</p>;
}

describe("renderWithCuple", () => {
  it("renders a suspending tree with a fresh store, no act() needed", async () => {
    const mock = mockCuple<typeof routes>({
      getTodos: { get: () => ({ result: "success", statusCode: 200, todos: ["bread"] }) },
    });
    vi.stubGlobal("fetch", mock.fetch);
    const { store } = await renderWithCuple(
      <Boundary fallback={<p>loading</p>}>
        <Todos />
      </Boundary>,
    );
    expect(await screen.findByText("todos: bread")).toBeDefined();
    expect(typeof store.refresh).toBe("function");
  });

  it("passes the provider's props through, e.g. notify", async () => {
    const notify = vi.fn();
    vi.stubGlobal("fetch", mockCuple<typeof routes>({}).fetch);
    let run!: () => Promise<unknown>;
    function Adder() {
      run = useAction(() => fetchCuple(client.addTodo.post, { body: { text: "x" } }), {
        config: { errors: { onError: "notify" } },
      }).run;
      return null;
    }
    await renderWithCuple(<Adder />, { config: { errors: { notify } } });
    await act(() => run());
    expect(notify).toHaveBeenCalled();
  });
});

describe("mockCuple", () => {
  it("answers each endpoint with its handler, given the typed input", async () => {
    const mock = mockCuple<typeof routes>({
      getTodo: {
        get: ({ params }) => ({
          result: "success",
          statusCode: 200,
          id: params.id,
          text: "tea",
        }),
      },
      addTodo: {
        post: ({ body }) => ({ result: "success", statusCode: 200, text: body.text }),
      },
      admin: { stats: { get: () => ({ result: "success", statusCode: 200, count: 7 }) } },
    });
    vi.stubGlobal("fetch", mock.fetch);

    const todo = await fetchCuple(client.getTodo.get, { params: { id: 3 } });
    const added = await fetchCuple(client.addTodo.post, {
      body: { text: "jam" },
    });
    const stats = await fetchCuple(client.admin.stats.get);

    expect(todo).toMatchObject({ id: 3, text: "tea" });
    expect(added).toMatchObject({ text: "jam" });
    expect(stats).toMatchObject({ count: 7 });
    expect(mock.calls.map((c) => c.endpoint)).toEqual([
      "getTodo.get",
      "addTodo.post",
      "admin.stats.get",
    ]);
    expect(mock.calls[1].input).toMatchObject({ body: { text: "jam" } });
  });

  it("sets the HTTP status from the result's statusCode", async () => {
    const mock = mockCuple<typeof routes>({
      getTodo: {
        get: () => ({
          result: "validation-error",
          statusCode: 422,
          message: "no",
          issues: [],
        }),
      },
    });
    vi.stubGlobal("fetch", mock.fetch);
    const res = await fetchCuple(client.getTodo.get, {
      params: { id: 1 },
    }).thenResolveAll();
    expect(res).toMatchObject({ result: "validation-error", statusCode: 422 });
  });

  it("fails a request with no handler, naming the endpoint", async () => {
    vi.stubGlobal("fetch", mockCuple<typeof routes>({}).fetch);
    await expect(fetchCuple(client.getTodos.get).thenResolveAll()).rejects.toThrow(
      /getTodos\.get/,
    );
  });

  it("types handlers against the routes", () => {
    mockCuple<typeof routes>({
      // @ts-expect-error the output must be one of the endpoint's results
      getTodos: { get: () => ({ result: "success", statusCode: 200, todos: 5 }) },
    });
    mockCuple<typeof routes>({
      // @ts-expect-error no such endpoint
      getNothing: { get: () => ({ result: "success", statusCode: 200 }) },
    });
  });
});
