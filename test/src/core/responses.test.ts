import { fetchCuple } from "@cuple/client";
import { conflict, forbidden, notFound, success, unauthorized } from "@cuple/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import createClientAndServer from "../utils/createClientAndServer";

describe("status factories", () => {
  it("default the result, status code and message", () => {
    expect(notFound()).toEqual({
      result: "not-found",
      statusCode: 404,
      message: "Not found.",
    });
    expect(unauthorized()).toEqual({
      result: "unauthorized",
      statusCode: 401,
      message: "Please sign in.",
    });
    expect(forbidden()).toEqual({
      result: "forbidden",
      statusCode: 403,
      message: "You don't have permission to do this.",
    });
    expect(conflict()).toEqual({
      result: "conflict",
      statusCode: 409,
      message: "This conflicts with the current state.",
    });
    expectTypeOf(notFound().result).toEqualTypeOf<"not-found">();
    expectTypeOf(notFound().statusCode).toEqualTypeOf<404>();
  });

  it("let the result and message be overridden, and keep extra fields", () => {
    const response = conflict({
      result: "email-taken",
      message: "Email in use.",
      email: "a@b.c",
    });
    expect(response).toEqual({
      result: "email-taken",
      statusCode: 409,
      message: "Email in use.",
      email: "a@b.c",
    });
    expectTypeOf(response.result).toEqualTypeOf<"email-taken">();
    expectTypeOf(response.statusCode).toEqualTypeOf<409>();
    expectTypeOf(response.message).toEqualTypeOf<string>();
    expectTypeOf(response.email).toEqualTypeOf<string>();
  });

  it("keep the default result when only the message is given", () => {
    const response = notFound({ message: "No such post." });
    expect(response).toEqual({
      result: "not-found",
      statusCode: 404,
      message: "No such post.",
    });
    expectTypeOf(response.result).toEqualTypeOf<"not-found">();
  });

  it("reach the client typed, so two 404s can be told apart", async () => {
    const cs = await createClientAndServer((builder) => ({
      getPost: builder.get(async ({ req }) => {
        if (req.query.missing === "post") return notFound({ result: "post-not-found" });
        if (req.query.missing === "author")
          return notFound({ result: "author-not-found" });
        return success({ title: "Hi" });
      }),
    }));
    await cs.run(async (client) => {
      const response = await fetchCuple(client.getPost.get, {});
      expectTypeOf(response.result).toEqualTypeOf<
        "success" | "post-not-found" | "author-not-found" | "unexpected-error"
      >();
      expect(response.result).toBe("success");
    });
  });
});
