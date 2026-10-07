import * as ts from "typescript";
import type { PropertyInfo, Schema, SchemaDefinitions } from "./types";

/**
 * How deep the walk goes before it gives up.
 *
 * The guards below name every cycle they can recognise, but a type the walk
 * cannot name has nowhere to point, so a bound is still what guarantees
 * termination. 32 is far past anything a readable API response reaches, so it
 * costs real schemas nothing, and it stays a backstop: hitting it yields
 * `unknown`, never a definition.
 */
const MAX_DEPTH = 32;

/**
 * How many times one generic alias may nest on a branch before the walk treats
 * it as unbounded and collapses it into a single definition.
 *
 * {@link growsFrom} catches the usual unbounded generic precisely, at the first
 * repeat. This is the backstop for one it cannot see — a generic that grows
 * through something other than its own type arguments. It is deliberately far
 * above any hand-written nesting, because collapsing keys the definition on the
 * alias symbol, and two instantiations of one generic only share a body when
 * the recursion is what produced them.
 */
const MAX_ALIAS_NESTING = 16;

/** How far {@link containsType} looks for the outer argument. */
const MAX_CONTAINS_DEPTH = 10;

/**
 * TypeScript's placeholder names for types that have no name of their own. A
 * definition cannot be keyed on one of these, so such a type stays `unknown`.
 */
const ANONYMOUS = new Set(["Array", "ReadonlyArray", "__type", "__object"]);

/**
 * The named definitions collected over one inspection, shared by every route so
 * a recursive type is described once.
 */
export type SchemaRegistry = {
  definitions: SchemaDefinitions;
  /** Definition name per type symbol; present as soon as the body is started. */
  names: Map<ts.Symbol, string>;
  used: Set<string>;
};

export function createSchemaRegistry(): SchemaRegistry {
  return { definitions: {}, names: new Map(), used: new Set() };
}

/** What the current branch has entered, so re-entry can be recognised. */
type Walk = {
  /**
   * The types currently being converted on this branch. A type that is its own
   * ancestor would otherwise recurse forever: a JSON value, a tree of nodes, a
   * Prisma `Json` column, two types that name each other.
   *
   * It has to be the ancestors rather than every type seen. A type that merely
   * appears twice side by side — `{ from: Address; to: Address }` — is not a
   * cycle and must still be described in full both times.
   */
  ancestors: Set<ts.Type>;
  /** Instantiations of each generic alias on this branch, outermost first. */
  aliases: Map<ts.Symbol, ts.Type[]>;
  /** Aliases whose every occurrence on this branch is the definition itself. */
  collapsing: Set<ts.Symbol>;
  depth: number;
};

export function convertTypeToSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  registry: SchemaRegistry,
): Schema {
  return convert(type, checker, registry, {
    ancestors: new Set(),
    aliases: new Map(),
    collapsing: new Set(),
    depth: 0,
  });
}

function convert(
  type: ts.Type,
  checker: ts.TypeChecker,
  registry: SchemaRegistry,
  walk: Walk,
): Schema {
  if (walk.ancestors.has(type)) return close(type, checker, registry);

  const alias = type.aliasSymbol;
  if (alias) {
    // Inside its own definition, every occurrence is the definition.
    if (walk.collapsing.has(alias)) return close(type, checker, registry);

    const outer = walk.aliases.get(alias);
    if (outer && (outer.length >= MAX_ALIAS_NESTING || growsFrom(type, outer, checker))) {
      return close(type, checker, registry);
    }
  }

  // The bound is only a backstop, so it cuts the branch rather than naming a
  // type that may not be recursive at all.
  if (walk.depth >= MAX_DEPTH) return { type: "unknown" };

  walk.ancestors.add(type);
  let nesting: ts.Type[] | undefined;
  if (alias) {
    nesting = walk.aliases.get(alias);
    if (!nesting) {
      nesting = [];
      walk.aliases.set(alias, nesting);
    }
    nesting.push(type);
  }
  walk.depth++;
  try {
    return describe(type, checker, registry, walk);
  } finally {
    walk.depth--;
    if (alias && nesting) {
      nesting.pop();
      if (nesting.length === 0) walk.aliases.delete(alias);
    }
    walk.ancestors.delete(type);
  }
}

/**
 * Ends the branch at a type the walk refuses to enter again, pointing at a
 * named definition of it. Only a type with no name of its own falls back to
 * `unknown`, since there is then nothing to point at.
 */
function close(type: ts.Type, checker: ts.TypeChecker, registry: SchemaRegistry): Schema {
  // An array's own symbol is just `Array`; the name is on its element.
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    if (!element) return { type: "array", items: { type: "unknown" } };
    return { type: "array", items: close(element, checker, registry) };
  }

  const name = define(type, checker, registry);
  return name === null ? { type: "unknown" } : { type: "ref", name };
}

/**
 * Registers `type` as a named definition and returns its name, or `null` when
 * the type is anonymous. The name is recorded before the body is described, so
 * the recursion inside the body closes on a `ref` back to it.
 */
function define(
  type: ts.Type,
  checker: ts.TypeChecker,
  registry: SchemaRegistry,
): string | null {
  const symbol = type.aliasSymbol ?? type.symbol;
  if (!symbol) return null;
  if (ANONYMOUS.has(symbol.name) || symbol.name.startsWith("__")) return null;

  const existing = registry.names.get(symbol);
  if (existing !== undefined) return existing;

  const name = reserve(symbol.name, registry);
  registry.names.set(symbol, name);
  registry.definitions[name] = { type: "unknown" };

  // A definition is context-free: described on its own branch, where it closes
  // back on itself. A generic collapses by symbol, because the levels of a
  // recursive generic differ only in the arguments that drive the recursion.
  const collapsing = new Set<ts.Symbol>();
  if (type.aliasSymbol && (type.aliasTypeArguments?.length ?? 0) > 0) {
    collapsing.add(type.aliasSymbol);
  }
  registry.definitions[name] = describe(type, checker, registry, {
    ancestors: new Set([type]),
    aliases: new Map(),
    collapsing,
    depth: 0,
  });
  return name;
}

/** OpenAPI component keys allow `[a-zA-Z0-9.\-_]`. */
function reserve(symbolName: string, registry: SchemaRegistry): string {
  const base = symbolName.replace(/[^A-Za-z0-9._-]/g, "_");
  let name = base;
  for (let n = 2; registry.used.has(name); n++) name = `${base}_${n}`;
  registry.used.add(name);
  return name;
}

/**
 * Whether this instantiation of a generic was produced by an outer one on the
 * same branch, i.e. its arguments contain theirs:
 * `type Deep<T> = { next: Deep<{ wrap: T }> }` instantiates `Deep<{ wrap: T }>`
 * from `Deep<T>`, so every level is a fresh type and nothing ever repeats. That
 * recursion is unbounded, and only a definition describes it faithfully.
 *
 * Two instantiations whose arguments are unrelated — the inner one of
 * `Value<{ foo: Value<{ bar: string }> }>` — are ordinary nesting and expand.
 */
function growsFrom(
  type: ts.Type,
  outer: readonly ts.Type[],
  checker: ts.TypeChecker,
): boolean {
  const args = type.aliasTypeArguments;
  if (!args?.length) return false;

  for (const ancestor of outer) {
    for (const target of ancestor.aliasTypeArguments ?? []) {
      for (const arg of args) {
        // The same argument is the same instantiation, which the ancestor set
        // already catches; growth means strictly containing it.
        if (arg === target) continue;
        if (containsType(arg, target, checker, 0, new Set())) return true;
      }
    }
  }
  return false;
}

function containsType(
  type: ts.Type,
  target: ts.Type,
  checker: ts.TypeChecker,
  depth: number,
  seen: Set<ts.Type>,
): boolean {
  if (type === target) return true;
  if (depth >= MAX_CONTAINS_DEPTH || seen.has(type)) return false;
  // Only composites can hold another type.
  if (!(type.flags & ts.TypeFlags.Object) && !type.isUnionOrIntersection()) return false;
  seen.add(type);

  for (const arg of type.aliasTypeArguments ?? []) {
    if (containsType(arg, target, checker, depth + 1, seen)) return true;
  }

  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      if (containsType(member, target, checker, depth + 1, seen)) return true;
    }
    return false;
  }

  // An array's members are its element, not `Array.prototype`.
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    for (const arg of checker.getTypeArguments(type as ts.TypeReference)) {
      if (containsType(arg, target, checker, depth + 1, seen)) return true;
    }
    return false;
  }

  for (const prop of type.getProperties()) {
    const propType = checker.getTypeOfSymbol(prop);
    if (containsType(propType, target, checker, depth + 1, seen)) return true;
  }
  return false;
}

function describe(
  type: ts.Type,
  checker: ts.TypeChecker,
  registry: SchemaRegistry,
  walk: Walk,
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
      return convert(filteredTypes[0], checker, registry, walk);
    }

    return {
      type: "union",
      variants: filteredTypes.map((t) => convert(t, checker, registry, walk)),
    };
  }

  // Handle array types
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return {
        type: "array",
        items: convert(typeArgs[0], checker, registry, walk),
      };
    }
    return { type: "array", items: { type: "unknown" } };
  }

  // Handle intersection types - merge into a single object
  if (type.isIntersection()) {
    const mergedProperties: Record<string, PropertyInfo> = {};
    for (const intersectedType of type.types) {
      const schema = convert(intersectedType, checker, registry, walk);
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
        schema: convert(effectiveType, checker, registry, walk),
        required: !isOptional,
      };
    }

    if (Object.keys(properties).length > 0) {
      return { type: "object", properties };
    }
  }

  return { type: "unknown" };
}
