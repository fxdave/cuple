import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("description extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should extract description from meta", () => {
    const route = routes.find((r) => r.name === "getStatus");
    expect(route).toBeDefined();
    expect(route!.description).toBe("Returns the current system status");
  });

  it("should return undefined when no description in meta", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.description).toBeUndefined();
  });

  it("should extract description from combined route", () => {
    const route = routes.find((r) => r.name === "updatePost");
    expect(route).toBeDefined();
    expect(route!.description).toBe("Updates an existing blog post");
  });
});
