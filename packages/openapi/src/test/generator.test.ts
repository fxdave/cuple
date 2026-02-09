import { describe, it, expect } from "vitest";
import path from "path";
import { generateOpenAPI } from "../generator";
import type { OpenAPIDocument, OpenAPIParameter } from "../generator";

const fixturePath = path.resolve(
  __dirname,
  "../../../inspect/src/test/fixtures/routes.ts",
);
const tsconfigPath = path.resolve(
  __dirname,
  "../../../inspect/src/test/fixtures/tsconfig.json",
);

describe("generateOpenAPI", () => {
  const doc: OpenAPIDocument = generateOpenAPI(fixturePath, "routes", {
    tsconfigPath,
  });

  it("should have OpenAPI 3.0.0 version", () => {
    expect(doc.openapi).toBe("3.0.0");
  });

  it("should have default info", () => {
    expect(doc.info.title).toBe("API");
    expect(doc.info.version).toBe("1.0.0");
  });

  it("should respect custom info options", () => {
    const custom = generateOpenAPI(fixturePath, "routes", {
      tsconfigPath,
      info: { title: "My API", version: "2.0.0", description: "Test API" },
    });
    expect(custom.info.title).toBe("My API");
    expect(custom.info.version).toBe("2.0.0");
    expect(custom.info.description).toBe("Test API");
  });

  it("should have paths for all routes", () => {
    const paths = Object.keys(doc.paths);
    expect(paths).toContain("/health");
    expect(paths).toContain("/status");
    expect(paths).toContain("/api/posts/{postId}/comments/{commentId}");
    expect(paths).toContain("/api/posts");
    expect(paths).toContain("/api/posts/{id}");
    expect(paths).toContain("/api/protected");
    expect(paths).toContain("/api/profile/{userId}");
    expect(paths).toContain("/api/posts/{postId}");
  });

  it("should convert :param to {param} in all paths", () => {
    for (const pathKey of Object.keys(doc.paths)) {
      expect(pathKey).not.toMatch(/:/);
    }
  });

  describe("GET /health", () => {
    it("should have no parameters", () => {
      const op = doc.paths["/health"]?.get;
      expect(op).toBeDefined();
      expect(op!.parameters).toBeUndefined();
    });

    it("should have a 200 response", () => {
      const op = doc.paths["/health"]?.get;
      expect(op!.responses["200"]).toBeDefined();
    });
  });

  describe("POST /api/posts", () => {
    it("should have a requestBody with object schema", () => {
      const op = doc.paths["/api/posts"]?.post;
      expect(op).toBeDefined();
      expect(op!.requestBody).toBeDefined();
      const schema = op!.requestBody!.content["application/json"].schema;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect(schema.properties!.title).toEqual({ type: "string" });
      expect(schema.properties!.content).toEqual({ type: "string" });
      expect(schema.properties!.published).toEqual({ type: "boolean" });
      expect(schema.properties!.tags).toEqual({
        type: "array",
        items: { type: "string" },
      });
      expect(schema.properties!.metadata).toBeDefined();
      expect(schema.properties!.metadata.type).toBe("object");
    });

    it("should have operationId and description", () => {
      const op = doc.paths["/api/posts"]?.post;
      expect(op!.operationId).toBe("posts.createPost");
      expect(op!.description).toBe("Creates a new blog post");
    });
  });

  describe("GET /api/posts (listPosts)", () => {
    it("should have query parameters", () => {
      const op = doc.paths["/api/posts"]?.get;
      expect(op).toBeDefined();
      const params = op!.parameters!;
      expect(params.length).toBeGreaterThanOrEqual(4);

      const queryParams = params.filter((p) => p.in === "query");
      const names = queryParams.map((p) => p.name);
      expect(names).toContain("page");
      expect(names).toContain("limit");
      expect(names).toContain("search");
      expect(names).toContain("status");

      // status is required, others are optional
      const statusParam = queryParams.find((p) => p.name === "status");
      expect(statusParam!.required).toBe(true);

      const pageParam = queryParams.find((p) => p.name === "page");
      expect(pageParam!.required).toBe(false);
    });
  });

  describe("GET /api/posts/{postId}/comments/{commentId}", () => {
    it("should have 2 path parameters", () => {
      const op = doc.paths["/api/posts/{postId}/comments/{commentId}"]?.get;
      expect(op).toBeDefined();
      const pathParams = op!.parameters!.filter((p: OpenAPIParameter) => p.in === "path");
      expect(pathParams.length).toBe(2);
      expect(pathParams[0].name).toBe("postId");
      expect(pathParams[0].required).toBe(true);
      expect(pathParams[1].name).toBe("commentId");
      expect(pathParams[1].required).toBe(true);
    });
  });

  describe("GET /api/protected", () => {
    it("should have header parameters", () => {
      const op = doc.paths["/api/protected"]?.get;
      expect(op).toBeDefined();
      const headerParams = op!.parameters!.filter(
        (p: OpenAPIParameter) => p.in === "header",
      );
      expect(headerParams.length).toBe(2);

      const authParam = headerParams.find(
        (p: OpenAPIParameter) => p.name === "authorization",
      );
      expect(authParam).toBeDefined();
      expect(authParam!.required).toBe(true);

      const requestIdParam = headerParams.find(
        (p: OpenAPIParameter) => p.name === "x-request-id",
      );
      expect(requestIdParam).toBeDefined();
      expect(requestIdParam!.required).toBe(false);
    });
  });

  describe("GET /api/profile/{userId}", () => {
    it("should have responses for 200, 403, and 404", () => {
      const op = doc.paths["/api/profile/{userId}"]?.get;
      expect(op).toBeDefined();
      const statusCodes = Object.keys(op!.responses);
      expect(statusCodes).toContain("200");
      expect(statusCodes).toContain("403");
      expect(statusCodes).toContain("404");
    });
  });

  it("should match the full document snapshot", () => {
    expect(doc).toMatchSnapshot();
  });

  describe("PUT /api/posts/{postId} (updatePost)", () => {
    it("should have requestBody", () => {
      const op = doc.paths["/api/posts/{postId}"]?.put;
      expect(op).toBeDefined();
      expect(op!.requestBody).toBeDefined();
    });

    it("should have path params", () => {
      const op = doc.paths["/api/posts/{postId}"]?.put;
      const pathParams = op!.parameters!.filter((p: OpenAPIParameter) => p.in === "path");
      expect(pathParams.length).toBe(1);
      expect(pathParams[0].name).toBe("postId");
      expect(pathParams[0].required).toBe(true);
    });

    it("should have header params", () => {
      const op = doc.paths["/api/posts/{postId}"]?.put;
      const headerParams = op!.parameters!.filter(
        (p: OpenAPIParameter) => p.in === "header",
      );
      expect(headerParams.length).toBeGreaterThanOrEqual(1);
    });

    it("should have multiple responses", () => {
      const op = doc.paths["/api/posts/{postId}"]?.put;
      const statusCodes = Object.keys(op!.responses);
      expect(statusCodes.length).toBeGreaterThanOrEqual(2);
      expect(statusCodes).toContain("200");
      expect(statusCodes).toContain("403");
    });

    it("should have operationId and description", () => {
      const op = doc.paths["/api/posts/{postId}"]?.put;
      expect(op!.operationId).toBe("updatePost");
      expect(op!.description).toBe("Updates an existing blog post");
    });
  });
});
