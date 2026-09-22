import { apiResponse, createBuilder, initRpc, success } from "@cuple/server";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

const builder = createBuilder(app);

type Post = { id: number; title: string; content: string };

const posts: Post[] = [
  {
    id: 1,
    title: "Getting Started with Cuple",
    content: "Cuple is a TypeScript RPC framework with REST compatibility.",
  },
  {
    id: 2,
    title: "Type-Safe APIs",
    content: "Cuple infers request and response types across the network boundary.",
  },
  {
    id: 3,
    title: "SWR Integration",
    content: "Cuple works seamlessly with SWR for data fetching in React.",
  },
];

let nextId = posts.length + 1;

// Artificial latency, so optimistic updates are visible in the UI.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const routes = {
  getPosts: builder.get(async () => {
    return success({ posts });
  }),

  getPost: builder
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .get(async ({ data }) => {
      const post = posts.find((p) => p.id === data.params.id);
      if (!post) return apiResponse("notFound", 404, { message: "Post not found" });
      return success({ post });
    }),

  createPost: builder
    .bodySchema(
      z.strictObject({
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .post(async ({ data }) => {
      await delay(600);
      const post: Post = { id: nextId++, ...data.body };
      posts.push(post);
      return success({ post });
    }),

  updatePost: builder
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .bodySchema(
      z.strictObject({
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
      }),
    )
    .patch(async ({ data }) => {
      await delay(600);
      const post = posts.find((p) => p.id === data.params.id);
      if (!post) return apiResponse("notFound", 404, { message: "Post not found" });
      Object.assign(post, data.body);
      return success({ post });
    }),

  deletePost: builder
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .delete(async ({ data }) => {
      await delay(600);
      const index = posts.findIndex((p) => p.id === data.params.id);
      if (index === -1)
        return apiResponse("notFound", 404, { message: "Post not found" });
      posts.splice(index, 1);
      return success({ deletedId: data.params.id });
    }),
};

initRpc(app, { path: "/rpc", routes });

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
