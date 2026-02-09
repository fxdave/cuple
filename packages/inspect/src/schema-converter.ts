import * as ts from "typescript";
import { Schema, PropertyInfo } from "./types";

export function convertTypeToSchema(type: ts.Type, checker: ts.TypeChecker): Schema {
  // Handle boolean first (TS represents boolean as union of true | false)
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { type: "boolean" };
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return { type: "boolean" };
  }

  // Handle string literal
  if (type.isStringLiteral()) {
    return { type: "literal", value: type.value };
  }

  // Handle number literal
  if (type.isNumberLiteral()) {
    return { type: "literal", value: type.value };
  }

  // Handle string
  if (type.flags & ts.TypeFlags.String) {
    return { type: "string" };
  }

  // Handle number
  if (type.flags & ts.TypeFlags.Number) {
    return { type: "number" };
  }

  // Handle unknown
  if (type.flags & ts.TypeFlags.Unknown) {
    return { type: "unknown" };
  }

  // Handle union types
  if (type.isUnion()) {
    // Filter out undefined from the union
    const filteredTypes = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));

    // Check if this is just true | false -> boolean
    if (
      filteredTypes.length === 2 &&
      filteredTypes.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)
    ) {
      return { type: "boolean" };
    }

    if (filteredTypes.length === 0) {
      return { type: "unknown" };
    }

    if (filteredTypes.length === 1) {
      return convertTypeToSchema(filteredTypes[0], checker);
    }

    return {
      type: "union",
      variants: filteredTypes.map((t) => convertTypeToSchema(t, checker)),
    };
  }

  // Handle array types
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return {
        type: "array",
        items: convertTypeToSchema(typeArgs[0], checker),
      };
    }
    return { type: "array", items: { type: "unknown" } };
  }

  // Handle intersection types - merge into a single object
  if (type.isIntersection()) {
    const mergedProperties: Record<string, PropertyInfo> = {};
    for (const intersectedType of type.types) {
      const schema = convertTypeToSchema(intersectedType, checker);
      if (schema.type === "object") {
        Object.assign(mergedProperties, schema.properties);
      }
    }
    if (Object.keys(mergedProperties).length > 0) {
      return { type: "object", properties: mergedProperties };
    }
    return { type: "unknown" };
  }

  // Handle object types
  if (type.flags & ts.TypeFlags.Object || type.getProperties().length > 0) {
    const properties: Record<string, PropertyInfo> = {};
    for (const prop of type.getProperties()) {
      const propName = prop.getName();
      // Skip internal properties
      if (propName.startsWith("_")) continue;

      const propType = checker.getTypeOfSymbol(prop);
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

      // For optional properties, the type includes undefined in a union
      // Strip undefined for the schema
      let effectiveType = propType;
      if (isOptional && propType.isUnion()) {
        const nonUndefined = propType.types.filter(
          (t) => !(t.flags & ts.TypeFlags.Undefined),
        );
        if (nonUndefined.length === 1) {
          effectiveType = nonUndefined[0];
        } else if (nonUndefined.length > 1) {
          // Reconstruct without creating a new union - just convert
          effectiveType = propType;
        }
      }

      properties[propName] = {
        schema: convertTypeToSchema(effectiveType, checker),
        required: !isOptional,
      };
    }

    if (Object.keys(properties).length > 0) {
      return { type: "object", properties };
    }
  }

  return { type: "unknown" };
}
