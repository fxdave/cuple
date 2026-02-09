import { describe, it, expect } from "vitest";
import path from "path";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("headers schema extraction", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  it("should return null when no headers schema", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    expect(route!.headersSchema).toBeNull();
  });

  it("should extract headers schema with required and optional fields", () => {
    const route = routes.find((r) => r.name === "protectedRoute");
    expect(route).toBeDefined();
    expect(route!.headersSchema).not.toBeNull();
    expect(route!.headersSchema!.type).toBe("object");

    if (route!.headersSchema!.type === "object") {
      const props = route!.headersSchema!.properties;

      expect(props.authorization).toBeDefined();
      expect(props.authorization.schema.type).toBe("string");
      expect(props.authorization.required).toBe(true);

      expect(props["x-request-id"]).toBeDefined();
      expect(props["x-request-id"].schema.type).toBe("string");
      expect(props["x-request-id"].required).toBe(false);
    }
  });

  it("should extract headers schema from combined route", () => {
    const route = routes.find((r) => r.name === "updatePost");
    expect(route).toBeDefined();
    expect(route!.headersSchema).not.toBeNull();
    expect(route!.headersSchema!.type).toBe("object");

    if (route!.headersSchema!.type === "object") {
      const props = route!.headersSchema!.properties;
      expect(props["x-request-id"]).toBeDefined();
      expect(props["x-request-id"].schema.type).toBe("string");
      expect(props["x-request-id"].required).toBe(true);
    }
  });
});
