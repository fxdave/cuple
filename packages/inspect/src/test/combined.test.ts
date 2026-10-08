import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("combined route inspection", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should extract all fields from a combined route", () => {
    const route = routes.find((r) => r.name === "updatePost");
    expect(route).toBeDefined();

    // Name
    expect(route!.name).toBe("updatePost");

    // Description
    expect(route!.description).toBe("Updates an existing blog post");

    // Method
    expect(route!.method).toBe("put");

    // Path
    expect(route!.path!.raw).toBe("/api/posts/:postId");
    expect(route!.path!.segments).toEqual([
      { type: "static", value: "api" },
      { type: "static", value: "posts" },
      { type: "param", name: "postId" },
    ]);

    // Params schema
    expect(route!.paramsSchema).not.toBeNull();
    expect(route!.paramsSchema!.type).toBe("object");

    // Headers schema
    expect(route!.headersSchema).not.toBeNull();
    expect(route!.headersSchema!.type).toBe("object");

    // Body schema
    expect(route!.bodySchema).not.toBeNull();
    expect(route!.bodySchema!.type).toBe("object");

    // Query schema (not set for this route)
    expect(route!.querySchema).toBeNull();

    // Response should have multiple variants
    expect(route!.response.length).toBeGreaterThanOrEqual(2);

    // Should have success variant
    const successVariant = route!.response.find((r) => r.result === "success");
    expect(successVariant).toBeDefined();
    expect(successVariant!.statusCode).toBe(200);

    // Should have forbidden from auth middleware
    const forbiddenVariant = route!.response.find((r) => r.result === "forbidden");
    expect(forbiddenVariant).toBeDefined();
    expect(forbiddenVariant!.statusCode).toBe(403);
  });

  it("should extract all routes from the fixture", () => {
    // Total routes: getHealth, getStatus, posts.getComment, posts.createPost,
    // posts.listPosts, posts.getPost, posts.deletePost, getProfile, protectedRoute,
    // updatePost, rpcOnly, register, getBlob, getTree, getArticle, getTrip,
    // getNestedGeneric, getGrowingGeneric
    expect(routes.length).toBe(18);
  });

  it("should keep routes without path, with a null path", () => {
    const route = routes.find((r) => r.name === "rpcOnly");
    expect(route?.path).toBeNull();
    expect(route?.method).toBe("post");
  });
});
