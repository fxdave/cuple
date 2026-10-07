import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectRoutesWithDefinitions } from "../index";
import type { Schema } from "../types";

const fixturePath = path.resolve(__dirname, "fixtures/routes.ts");
const tsconfigPath = path.resolve(__dirname, "fixtures/tsconfig.json");

describe("recursive response types", () => {
  const { routes, definitions } = inspectRoutesWithDefinitions(fixturePath, "routes", {
    tsconfigPath,
  });

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
    // The union's scalar arms survive; the arm that closes the cycle points at
    // the definition.
    expect(blob.schema.type).toBe("union");
    if (blob.schema.type !== "union") return;
    expect(blob.schema.variants).toContainEqual({
      type: "array",
      items: { type: "ref", name: "JsonValue" },
    });
    expect(definitions.JsonValue).toBeDefined();
  });

  it("names a recursive type once and points the cycle back at it", () => {
    const root = success("getTree").properties.root;
    expect(root.schema.type).toBe("object");
    if (root.schema.type !== "object") return;

    expect(root.schema.properties.label.schema.type).toBe("string");

    // `TreeNode` is its own ancestor here, so instead of being cut off it
    // becomes a named definition the cycle refers to.
    expect(root.schema.properties.children.schema).toEqual({
      type: "array",
      items: { type: "ref", name: "TreeNode" },
    });

    expect(definitions.TreeNode).toEqual({
      type: "object",
      properties: {
        label: { schema: { type: "string" }, required: true },
        children: {
          schema: { type: "array", items: { type: "ref", name: "TreeNode" } },
          required: true,
        },
      },
    });
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

    // Article is an ancestor of this position, so `latest` refers to it.
    const latest = author.properties.latest.schema;
    expect(latest.type).toBe("union");
    if (latest.type !== "union") return;
    expect(latest.variants).toContainEqual({ type: "ref", name: "Article" });
    expect(definitions.Article).toBeDefined();
  });

  it("keeps two different instantiations of one generic apart", () => {
    // Value<{ foo: Value<{ bar: string }> }>: the inner Value is a different
    // instantiation, so it must be described, not treated as a cycle.
    const v = success("getNestedGeneric").properties.v.schema;
    expect(v.type).toBe("object");
    if (v.type !== "object") return;
    const outer = v.properties.value.schema;
    expect(outer.type).toBe("object");
    if (outer.type !== "object") return;
    const foo = outer.properties.foo.schema;
    expect(foo.type).toBe("object");
    if (foo.type !== "object") return;
    const inner = foo.properties.value.schema;
    expect(inner.type).toBe("object");
    if (inner.type !== "object") return;
    expect(inner.properties.bar.schema.type).toBe("string");
    // Ordinary nesting earns no definition.
    expect(definitions.Value).toBeUndefined();
  });

  it("collapses a generic that recurses with a growing argument", () => {
    // Deep<T> = { next: Deep<{ wrap: T }> } never repeats a type, so the
    // ancestor check cannot fire. Every level has the same shape, so one
    // self-referencing definition describes all of them.
    const d = success("getGrowingGeneric").properties.d.schema;
    expect(d).toEqual({
      type: "object",
      properties: { next: { schema: { type: "ref", name: "Deep" }, required: true } },
    });
    expect(definitions.Deep).toEqual({
      type: "object",
      properties: { next: { schema: { type: "ref", name: "Deep" }, required: true } },
    });
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
    // Neither is recursive, so neither is named.
    expect(definitions.Address).toBeUndefined();
  });

  it("keeps two recursive types that share a name apart", () => {
    const props = success("getShapes").properties;
    const names = ["alpha", "beta"].map((key) => {
      const schema = props[key].schema;
      expect(schema.type, key).toBe("object");
      if (schema.type !== "object") return null;
      const back = schema.properties[key === "alpha" ? "next" : "prev"].schema;
      expect(back.type).toBe("union");
      if (back.type !== "union") return null;
      const ref = back.variants.find((variant) => variant.type === "ref");
      expect(ref, `${key} should close on a ref`).toBeDefined();
      return ref?.type === "ref" ? ref.name : null;
    });

    expect(names).toEqual(["Shape", "Shape_2"]);
    expect(definitions.Shape).toMatchObject({
      properties: { tag: { schema: { type: "literal", value: "a" } } },
    });
    expect(definitions.Shape_2).toMatchObject({
      properties: { tag: { schema: { type: "literal", value: "b" } } },
    });
  });

  it("resolves every ref it emits", () => {
    const seen: string[] = [];
    function walk(schema: Schema | null): void {
      if (schema === null) return;
      if (schema.type === "ref") {
        seen.push(schema.name);
        expect(definitions, `definition ${schema.name}`).toHaveProperty(schema.name);
      } else if (schema.type === "array") {
        walk(schema.items);
      } else if (schema.type === "union") {
        for (const variant of schema.variants) walk(variant);
      } else if (schema.type === "object") {
        for (const property of Object.values(schema.properties)) walk(property.schema);
      }
    }

    for (const route of routes) {
      walk(route.bodySchema);
      walk(route.querySchema);
      walk(route.paramsSchema);
      walk(route.headersSchema);
      for (const variant of route.response) {
        for (const property of Object.values(variant.properties)) walk(property.schema);
      }
    }
    for (const schema of Object.values(definitions)) walk(schema);

    expect(seen.length).toBeGreaterThan(0);
    // Nothing is defined that nothing points at.
    expect(new Set(seen)).toEqual(new Set(Object.keys(definitions)));
  });

  it("defines nothing for an API without recursion", () => {
    const route = routes.find((r) => r.name === "getHealth");
    expect(route).toBeDefined();
    // Sanity: the non-recursive routes carry no refs at all.
    expect(JSON.stringify(route)).not.toContain('"ref"');
  });
});
