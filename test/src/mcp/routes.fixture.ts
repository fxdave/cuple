import { apiResponse, createBuilder, initRpc, success } from "@cuple/server";
import express from "express";
import { z } from "zod";

export const app = express();
const builder = createBuilder(app);

const auth = builder
  .headersSchema(z.looseObject({ authorization: z.string() }))
  .middleware(async ({ data }) =>
    data.headers.authorization === "Bearer t-123"
      ? { next: true }
      : { next: false, statusCode: 401, result: "unauthorized" as const },
  )
  .buildLink();

export const routes = {
  auth: {
    login: builder
      .meta({ description: "Signs in with a password, and returns a token" })
      .bodySchema(z.object({ password: z.string() }))
      .post(async ({ data }) =>
        data.body.password === "hunter2"
          ? success({ token: "t-123" })
          : apiResponse("unauthorized", 401, { message: "Wrong password" }),
      ),
  },
  posts: {
    getPost: builder
      .meta({ description: "Gets one post" })
      .path("/posts/:id")
      .paramsSchema(z.object({ id: z.coerce.number() }))
      .get(async ({ data }) =>
        data.params.id === 1
          ? success({ title: "Hello" })
          : apiResponse("not-found", 404, { message: "No such post" }),
      ),
    search: builder
      .querySchema(z.object({ q: z.string().optional() }))
      .get(async ({ data }) => success({ q: data.query.q ?? null })),
  },
  createPost: builder
    .chain(auth)
    .bodySchema(z.object({ title: z.string() }))
    .post(async ({ data }) => success({ title: data.body.title })),
};

initRpc(app, { path: "/rpc", routes });
