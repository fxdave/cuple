import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("path extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should extract simple path", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.path.raw).toBe("/health");
    expect(route!.path.segments).toEqual([{ type: "static", value: "health" }]);
  });

  it("should extract path with single param", () => {
    const route = routes.find((r) => r.name === "posts.getPost");
    expect(route).toBeDefined();
    expect(route!.path.raw).toBe("/api/posts/:id");
    expect(route!.path.segments).toEqual([
      { type: "static", value: "api" },
      { type: "static", value: "posts" },
      { type: "param", name: "id" },
    ]);
  });

  it("should extract path with multiple params", () => {
    const route = routes.find((r) => r.name === "posts.getComment");
    expect(route).toBeDefined();
    expect(route!.path.raw).toBe("/api/posts/:postId/comments/:commentId");
    expect(route!.path.segments).toEqual([
      { type: "static", value: "api" },
      { type: "static", value: "posts" },
      { type: "param", name: "postId" },
      { type: "static", value: "comments" },
      { type: "param", name: "commentId" },
    ]);
  });

  it("should extract method correctly", () => {
    const getRoute = routes.find((r) => r.name === "getHealth");
    expect(getRoute!.method).toBe("get");

    const postRoute = routes.find((r) => r.name === "posts.createPost");
    expect(postRoute!.method).toBe("post");

    const putRoute = routes.find((r) => r.name === "updatePost");
    expect(putRoute!.method).toBe("put");

    const deleteRoute = routes.find((r) => r.name === "posts.deletePost");
    expect(deleteRoute!.method).toBe("delete");
  });
});
