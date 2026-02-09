import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("query schema extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should return null when no query schema", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.querySchema).toBeNull();
  });

  it("should extract query schema with required and optional fields", () => {
    const route = routes.find((r) => r.name === "posts.listPosts");
    expect(route).toBeDefined();
    expect(route!.querySchema).not.toBeNull();
    expect(route!.querySchema!.type).toBe("object");

    if (route!.querySchema!.type === "object") {
      const props = route!.querySchema!.properties;

      // Optional fields
      expect(props.page).toBeDefined();
      expect(props.page.schema.type).toBe("number");
      expect(props.page.required).toBe(false);

      expect(props.limit).toBeDefined();
      expect(props.limit.schema.type).toBe("number");
      expect(props.limit.required).toBe(false);

      expect(props.search).toBeDefined();
      expect(props.search.schema.type).toBe("string");
      expect(props.search.required).toBe(false);

      // Required field
      expect(props.status).toBeDefined();
      expect(props.status.schema.type).toBe("string");
      expect(props.status.required).toBe(true);
    }
  });
});
