import express from "express";
import z from "zod";
import { createBuilder, apiResponse, success } from "@cuple/server";

const app = express();
const builder = createBuilder(app);

// Builder with auth middleware that returns 403 on failure
const authedBuilder = builder.middleware(async ({ req }) => {
  const token = req.headers.authorization;
  if (!token) {
    return {
      ...apiResponse("forbidden", 403, { message: "Not authenticated" }),
      next: false as const,
    };
  }
  return { next: true as const, userId: "user-123" };
});

// --- Minimal route: just name from property key ---
const getHealth = builder.path("/health").get(async () => {
  return success({ status: "ok" });
});

// --- Route with description via meta ---
const getStatus = builder
  .meta({ name: "System Status", description: "Returns the current system status" })
  .path("/status")
  .get(async () => {
    return success({ uptime: 12345 });
  });

// --- Route with complex path params ---
const getComment = builder
  .path("/api/posts/:postId/comments/:commentId")
  .paramsSchema(
    z.object({
      postId: z.string(),
      commentId: z.string(),
    }),
  )
  .get(async ({ data }) => {
    return success({ text: "Great post!", author: "user1" });
  });

// --- Route with body schema including nested objects and optional fields ---
const createPost = builder
  .meta({ name: "Create Post", description: "Creates a new blog post" })
  .path("/api/posts")
  .bodySchema(
    z.object({
      title: z.string(),
      content: z.string(),
      published: z.boolean().optional(),
      tags: z.array(z.string()),
      metadata: z.object({
        category: z.string(),
        priority: z.number().optional(),
      }),
    }),
  )
  .post(async ({ data }) => {
    return success({ id: "post-1" });
  });

// --- Route with query schema including optional fields ---
const listPosts = builder
  .path("/api/posts")
  .querySchema(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      status: z.string(),
    }),
  )
  .get(async ({ data }) => {
    return success({ posts: [] as string[], total: 0 });
  });

// --- Route with params schema using z.coerce ---
const getPost = builder
  .path("/api/posts/:id")
  .paramsSchema(
    z.object({
      id: z.coerce.number(),
    }),
  )
  .get(async ({ data }) => {
    return success({ title: "Hello", content: "World" });
  });

// --- Route with headers schema ---
const protectedRoute = builder
  .path("/api/protected")
  .headersSchema(
    z.object({
      authorization: z.string(),
      "x-request-id": z.string().optional(),
    }),
  )
  .get(async ({ data }) => {
    return success({ data: "secret" });
  });

// --- Route with multiple response types ---
const getProfile = authedBuilder
  .path("/api/profile/:userId")
  .paramsSchema(z.object({ userId: z.string() }))
  .get(async ({ data }) => {
    if (!data.userId) {
      return apiResponse("not-found", 404, { message: "User not found" });
    }
    return success({ name: "John", email: "john@example.com" });
  });

// --- Combined route with ALL features ---
const updatePost = authedBuilder
  .meta({ name: "Update Post", description: "Updates an existing blog post" })
  .path("/api/posts/:postId")
  .paramsSchema(z.object({ postId: z.string() }))
  .headersSchema(z.object({ "x-request-id": z.string() }))
  .bodySchema(
    z.object({
      title: z.string().optional(),
      content: z.string().optional(),
    }),
  )
  .put(async ({ data }) => {
    return success({ updated: true });
  });

// --- Route with DELETE method ---
const deletePost = builder
  .path("/api/posts/:id")
  .paramsSchema(z.object({ id: z.string() }))
  .delete(async ({ data }) => {
    return success({ deleted: true });
  });

export const routes = {
  getHealth,
  getStatus,
  posts: {
    getComment,
    createPost,
    listPosts,
    getPost,
    deletePost,
  },
  getProfile,
  protectedRoute,
  updatePost,
};
