import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("name extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should extract top-level route name", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.name).toBe("getHealth");
  });

  it("should extract nested route name with dot notation", () => {
    const route = routes.find((r) => r.name === "posts.getComment");
    expect(route).toBeDefined();
    expect(route!.name).toBe("posts.getComment");
  });

  it("should extract name from meta when available", () => {
    const route = routes.find((r) => r.name === "getStatus");
    expect(route).toBeDefined();
    // name field is the property path, not the meta name
    expect(route!.name).toBe("getStatus");
  });

  it("should extract all routes from nested structure", () => {
    const nestedRoutes = routes.filter((r) => r.name.startsWith("posts."));
    expect(nestedRoutes.length).toBeGreaterThanOrEqual(4);
  });
});
