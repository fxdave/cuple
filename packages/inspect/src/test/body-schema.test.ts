import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("body schema extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should return null when no body schema", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.bodySchema).toBeNull();
  });

  it("should extract body schema with nested objects and optional fields", () => {
    const route = routes.find((r) => r.name === "posts.createPost");
    expect(route).toBeDefined();
    expect(route!.bodySchema).not.toBeNull();
    expect(route!.bodySchema!.type).toBe("object");

    if (route!.bodySchema!.type === "object") {
      const props = route!.bodySchema!.properties;

      // Required string fields
      expect(props.title).toBeDefined();
      expect(props.title.schema.type).toBe("string");
      expect(props.title.required).toBe(true);

      expect(props.content).toBeDefined();
      expect(props.content.schema.type).toBe("string");
      expect(props.content.required).toBe(true);

      // Optional boolean field
      expect(props.published).toBeDefined();
      expect(props.published.schema.type).toBe("boolean");
      expect(props.published.required).toBe(false);

      // Array field
      expect(props.tags).toBeDefined();
      expect(props.tags.schema.type).toBe("array");
      expect(props.tags.required).toBe(true);
      if (props.tags.schema.type === "array") {
        expect(props.tags.schema.items.type).toBe("string");
      }

      // Nested object
      expect(props.metadata).toBeDefined();
      expect(props.metadata.schema.type).toBe("object");
      if (props.metadata.schema.type === "object") {
        expect(props.metadata.schema.properties.category.schema.type).toBe("string");
        expect(props.metadata.schema.properties.category.required).toBe(true);
        expect(props.metadata.schema.properties.priority.schema.type).toBe("number");
        expect(props.metadata.schema.properties.priority.required).toBe(false);
      }
    }
  });

  it("should extract body schema from combined route", () => {
    const route = routes.find((r) => r.name === "updatePost");
    expect(route).toBeDefined();
    expect(route!.bodySchema).not.toBeNull();
    expect(route!.bodySchema!.type).toBe("object");

    if (route!.bodySchema!.type === "object") {
      const props = route!.bodySchema!.properties;
      expect(props.title).toBeDefined();
      expect(props.title.required).toBe(false);
      expect(props.content).toBeDefined();
      expect(props.content.required).toBe(false);
    }
  });
});
