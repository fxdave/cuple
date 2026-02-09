import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("params schema extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should return null when no params schema", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.paramsSchema).toBeNull();
  });

  it("should extract params schema with string params", () => {
    const route = routes.find((r) => r.name === "posts.getComment");
    expect(route).toBeDefined();
    expect(route!.paramsSchema).not.toBeNull();
    expect(route!.paramsSchema!.type).toBe("object");

    if (route!.paramsSchema!.type === "object") {
      const props = route!.paramsSchema!.properties;

      expect(props.postId).toBeDefined();
      expect(props.postId.schema.type).toBe("string");
      expect(props.postId.required).toBe(true);

      expect(props.commentId).toBeDefined();
      expect(props.commentId.schema.type).toBe("string");
      expect(props.commentId.required).toBe(true);
    }
  });

  it("should extract params schema with z.coerce (produces unknown type)", () => {
    const route = routes.find((r) => r.name === "posts.getPost");
    expect(route).toBeDefined();
    expect(route!.paramsSchema).not.toBeNull();
    expect(route!.paramsSchema!.type).toBe("object");

    if (route!.paramsSchema!.type === "object") {
      const props = route!.paramsSchema!.properties;
      expect(props.id).toBeDefined();
      // z.coerce.number() accepts unknown input, so tInput sees unknown
      expect(props.id.schema.type).toBe("unknown");
      expect(props.id.required).toBe(true);
    }
  });
});
