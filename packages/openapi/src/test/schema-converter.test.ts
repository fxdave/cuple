import { describe, it, expect } from "vitest";
import { convertSchemaToOpenAPI, convertPropertiesToOpenAPI } from "../schema-converter";
import type { Schema, PropertyInfo } from "@cuple/inspect";

describe("convertSchemaToOpenAPI", () => {
  it("should convert string schema", () => {
    const result = convertSchemaToOpenAPI({ type: "string" });
    expect(result).toEqual({ type: "string" });
  });

  it("should convert number schema", () => {
    const result = convertSchemaToOpenAPI({ type: "number" });
    expect(result).toEqual({ type: "number" });
  });

  it("should convert boolean schema", () => {
    const result = convertSchemaToOpenAPI({ type: "boolean" });
    expect(result).toEqual({ type: "boolean" });
  });

  it("should convert unknown schema to empty object", () => {
    const result = convertSchemaToOpenAPI({ type: "unknown" });
    expect(result).toEqual({});
  });

  it("should convert literal string", () => {
    const result = convertSchemaToOpenAPI({ type: "literal", value: "hello" });
    expect(result).toEqual({ type: "string", enum: ["hello"] });
  });

  it("should convert literal number", () => {
    const result = convertSchemaToOpenAPI({ type: "literal", value: 42 });
    expect(result).toEqual({ type: "number", enum: [42] });
  });

  it("should convert literal boolean", () => {
    const result = convertSchemaToOpenAPI({ type: "literal", value: true });
    expect(result).toEqual({ type: "boolean", enum: [true] });
  });

  it("should convert array schema", () => {
    const schema: Schema = { type: "array", items: { type: "string" } };
    const result = convertSchemaToOpenAPI(schema);
    expect(result).toEqual({ type: "array", items: { type: "string" } });
  });

  it("should convert union schema", () => {
    const schema: Schema = {
      type: "union",
      variants: [{ type: "string" }, { type: "number" }],
    };
    const result = convertSchemaToOpenAPI(schema);
    expect(result).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("should convert object schema with required and optional properties", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        name: { schema: { type: "string" }, required: true },
        age: { schema: { type: "number" }, required: false },
      },
    };
    const result = convertSchemaToOpenAPI(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
  });

  it("should omit required array when all properties are optional", () => {
    const schema: Schema = {
      type: "object",
      properties: {
        a: { schema: { type: "string" }, required: false },
        b: { schema: { type: "number" }, required: false },
      },
    };
    const result = convertSchemaToOpenAPI(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    });
    expect(result.required).toBeUndefined();
  });

  it("should convert nested object inside array", () => {
    const schema: Schema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { schema: { type: "number" }, required: true },
          label: { schema: { type: "string" }, required: true },
        },
      },
    };
    const result = convertSchemaToOpenAPI(schema);
    expect(result).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          label: { type: "string" },
        },
        required: ["id", "label"],
      },
    });
  });
});

describe("convertPropertiesToOpenAPI", () => {
  it("should convert properties and separate required fields", () => {
    const props: Record<string, PropertyInfo> = {
      name: { schema: { type: "string" }, required: true },
      email: { schema: { type: "string" }, required: true },
      bio: { schema: { type: "string" }, required: false },
    };
    const result = convertPropertiesToOpenAPI(props);
    expect(result.properties).toEqual({
      name: { type: "string" },
      email: { type: "string" },
      bio: { type: "string" },
    });
    expect(result.required).toEqual(["name", "email"]);
  });
});
