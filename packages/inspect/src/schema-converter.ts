import * as ts from "typescript";
import type { PropertyInfo, Schema } from "./types";

/**
 * How deep the walk goes before it gives up and says `unknown`.
 *
 * The ancestor check below catches a type that is literally its own ancestor,
 * but it cannot catch a generic that recurses with a *growing* argument —
 * `type Deep<T> = { next: Deep<{ wrap: T }> }` — because every level is a fresh
 * instantiation with its own identity, so nothing ever repeats. Only a bound
 * terminates that.
 *
 * 32 is far past anything a readable API response reaches, so it costs real
 * schemas nothing.
 */
const MAX_DEPTH = 32;

export function convertTypeToSchema(type: ts.Type, checker: ts.TypeChecker): Schema {
  return convert(type, checker, new Set(), 0);
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
  depth: number,
): Schema {
  if (ancestors.has(type)) return { type: "unknown" };
  if (depth >= MAX_DEPTH) return { type: "unknown" };

  ancestors.add(type);
  try {
    return describe(type, checker, ancestors, depth + 1);
  } finally {
    ancestors.delete(type);
  }
}

function describe(
  type: ts.Type,
  checker: ts.TypeChecker,
  ancestors: Set<ts.Type>,
  depth: number,
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
      return convert(filteredTypes[0], checker, ancestors, depth);
    }

    return {
      type: "union",
      variants: filteredTypes.map((t) => convert(t, checker, ancestors, depth)),
    };
  }

  // Handle array types
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return {
        type: "array",
        items: convert(typeArgs[0], checker, ancestors, depth),
      };
    }
    return { type: "array", items: { type: "unknown" } };
  }

  // Handle intersection types - merge into a single object
  if (type.isIntersection()) {
    const mergedProperties: Record<string, PropertyInfo> = {};
    for (const intersectedType of type.types) {
      const schema = convert(intersectedType, checker, ancestors, depth);
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
        schema: convert(effectiveType, checker, ancestors, depth),
        required: !isOptional,
      };
    }

    if (Object.keys(properties).length > 0) {
      return { type: "object", properties };
    }
  }

  return { type: "unknown" };
}
