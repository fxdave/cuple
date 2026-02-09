import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("response extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should extract simple success response", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();

    const successVariant = route!.response.find((r) => r.result === "success");
    expect(successVariant).toBeDefined();
    expect(successVariant!.statusCode).toBe(200);
    expect(successVariant!.properties.status).toBeDefined();
    expect(successVariant!.properties.status.schema.type).toBe("string");
  });

  it("should extract unexpected-error response", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();

    const errorVariant = route!.response.find((r) => r.result === "unexpected-error");
    expect(errorVariant).toBeDefined();
    expect(errorVariant!.statusCode).toBe(500);
    expect(errorVariant!.properties.message).toBeDefined();
  });

  it("should extract multiple response variants from middleware + handler", () => {
    const route = routes.find((r) => r.name === "getProfile");
    expect(route).toBeDefined();

    // Should have success from handler
    const successVariant = route!.response.find((r) => r.result === "success");
    expect(successVariant).toBeDefined();
    expect(successVariant!.statusCode).toBe(200);

    // Should have not-found from handler
    const notFoundVariant = route!.response.find((r) => r.result === "not-found");
    expect(notFoundVariant).toBeDefined();
    expect(notFoundVariant!.statusCode).toBe(404);

    // Should have forbidden from auth middleware
    const forbiddenVariant = route!.response.find((r) => r.result === "forbidden");
    expect(forbiddenVariant).toBeDefined();
    expect(forbiddenVariant!.statusCode).toBe(403);
  });

  it("should extract validation-error response from schema validation", () => {
    const route = routes.find((r) => r.name === "posts.createPost");
    expect(route).toBeDefined();

    const validationVariant = route!.response.find(
      (r) => r.result === "validation-error",
    );
    expect(validationVariant).toBeDefined();
    expect(validationVariant!.statusCode).toBe(422);
  });

  it("should extract response properties (excluding result, statusCode, next)", () => {
    const route = routes.find((r) => r.name === "getProfile");
    expect(route).toBeDefined();

    const successVariant = route!.response.find((r) => r.result === "success");
    expect(successVariant).toBeDefined();
    expect(successVariant!.properties.name).toBeDefined();
    expect(successVariant!.properties.email).toBeDefined();

    // Should NOT contain result, statusCode, or next
    expect(successVariant!.properties).not.toHaveProperty("result");
    expect(successVariant!.properties).not.toHaveProperty("statusCode");
    expect(successVariant!.properties).not.toHaveProperty("next");
  });
});
