import express from "express";
import { z } from "zod";
import { createBuilder, initRpc } from "../src/server";
import { apiResponse, success } from "../src/server/responses";

const app = express();
app.use(express.json());
const builder = createBuilder(app);

const posts = [
  { id: 1, title: "Hi again", content: "This is my second post" },
  { id: 2, title: "Hi", content: "This is my first post" },
];

export const routes = {
  getPosts: builder.get(async () => {
    return success({ posts });
  }),
  getPost: builder
    .paramsSchema(
      z.object({
        id: z.coerce.number(),
      })
    )
    .get(async ({ data }) => {
      const post = posts.find((p) => p.id === data.params.id);
      if (!post)
        return apiResponse("notFound", 404, {
          message: "This post is not found",
        });

      return success({
        post,
      });
    }),
  addPost: builder
    .bodySchema(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .post(async ({ data }) => {
      const nextId =
        Math.max.apply(
          Math,
          posts.map((post) => post.id)
        ) + 1;
      const newPost = { id: nextId, ...data.body };
      posts.push(newPost);
      return success({
        message: "The post has been created successfully",
        post: newPost,
      });
    }),
  deletePost: builder
    .paramsSchema(
      z.object({
        id: z.coerce.number(),
      })
    )
    .delete(async ({ data }) => {
      const idx = posts.findIndex((post) => post.id === data.params.id);
      if (idx === -1)
        return apiResponse("notFound", 404, {
          message: "This post is not found",
        });

      posts.splice(idx, 1);

      return success({
        message: "This post has been deleted successfully",
      });
    }),
};

initRpc(app, {
  path: "/rpc",
  routes,
});

app.listen(8080, () => {
  console.log(`Example app listening on port 8080`);
});
