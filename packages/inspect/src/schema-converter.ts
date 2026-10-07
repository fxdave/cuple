import * as ts from "typescript";
import type { PropertyInfo, Schema } from "./types";

export function convertTypeToSchema(type: ts.Type, checker: ts.TypeChecker): Schema {
  return convert(type, checker, new Set());
}

/**
 * `ancestors` holds the types currently being converted on this branch. A type
 * that is its own ancestor would otherwise recurse forever: a JSON value, a tree
 * of nodes, a Prisma `Json` column, two types that name each other. Those stop
 * as `unknown`, since `Schema` has no way to point back at an enclosing type.
 *
 * It has to be the ancestors rather than every type seen. A type that merely
 * appears twice side by side — `{ from: Address; to: Address }` — is not a cycle
 * and must still be described in full both times.
 */
function convert(
  type: ts.Type,
  checker: ts.TypeChecker,
  ancestors: Set<ts.Type>,
): Schema {
  if (ancestors.has(type)) return { type: "unknown" };

  ancestors.add(type);
  try {
    return describe(type, checker, ancestors);
  } finally {
    ancestors.delete(type);
  }
}

function describe(
  type: ts.Type,
  checker: ts.TypeChecker,
  ancestors: Set<ts.Type>,
): Schema {
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
      return convert(filteredTypes[0], checker, ancestors);
    }

    return {
      type: "union",
      variants: filteredTypes.map((t) => convert(t, checker, ancestors)),
    };
  }

  // Handle array types
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return {
        type: "array",
        items: convert(typeArgs[0], checker, ancestors),
      };
    }
    return { type: "array", items: { type: "unknown" } };
  }

  // Handle intersection types - merge into a single object
  if (type.isIntersection()) {
    const mergedProperties: Record<string, PropertyInfo> = {};
    for (const intersectedType of type.types) {
      const schema = convert(intersectedType, checker, ancestors);
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
        schema: convert(effectiveType, checker, ancestors),
        required: !isOptional,
      };
    }

    if (Object.keys(properties).length > 0) {
      return { type: "object", properties };
    }
  }

  return { type: "unknown" };
}
