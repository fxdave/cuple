import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectRoutes } from "../index";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("recursive response types", () => {
  const routes = inspectRoutes(fixturePath, "routes", { tsconfigPath });

  function success(name: string) {
    const route = routes.find((r) => r.name === name);
    expect(route, `route ${name}`).toBeDefined();
    const variant = route!.response.find((r) => r.result === "success");
    expect(variant, `success variant of ${name}`).toBeDefined();
    return variant!;
  }

  it("describes a self-recursive JSON value without recursing forever", () => {
    const blob = success("getBlob").properties.blob;
    expect(blob).toBeDefined();
    // The union's scalar arms survive; the arms that close the cycle stop.
    expect(blob.schema.type).toBe("union");
  });

  it("describes a tree one level deep and stops at the cycle", () => {
    const root = success("getTree").properties.root;
    expect(root.schema.type).toBe("object");
    if (root.schema.type !== "object") return;

    expect(root.schema.properties.label.schema.type).toBe("string");

    const children = root.schema.properties.children.schema;
    expect(children.type).toBe("array");
    if (children.type !== "array") return;
    // `TreeNode` is its own ancestor here, so it is not expanded again.
    expect(children.items.type).toBe("unknown");
  });

  it("stops on mutual recursion, not just self-recursion", () => {
    const article = success("getArticle").properties.article.schema;
    expect(article.type).toBe("object");
    if (article.type !== "object") return;

    expect(article.properties.title.schema.type).toBe("string");

    const author = article.properties.author.schema;
    expect(author.type).toBe("object");
    if (author.type !== "object") return;
    expect(author.properties.name.schema.type).toBe("string");
    // Article is an ancestor of this position, so `latest` must not expand it.
    expect(author.properties.latest.schema.type).not.toBe("object");
  });

  it("still expands a type that merely repeats across siblings", () => {
    const props = success("getTrip").properties;
    for (const key of ["from", "to"]) {
      const schema = props[key].schema;
      expect(schema.type, `${key} should be a full object`).toBe("object");
      if (schema.type !== "object") continue;
      expect(schema.properties.city.schema.type).toBe("string");
      expect(schema.properties.zip.schema.type).toBe("string");
    }
  });
});
