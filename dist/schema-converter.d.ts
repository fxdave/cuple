import * as ts from "typescript";
import type { Schema, SchemaDefinitions } from "./types";
/**
 * The named definitions collected over one inspection, shared by every route so
 * a recursive type is described once.
 */
export type SchemaRegistry = {
    definitions: SchemaDefinitions;
    /** Definition name per type symbol; present as soon as the body is started. */
    names: Map<ts.Symbol, string>;
    used: Set<string>;
    /** {@link Shared} subtrees, so a type reached many times is converted once. */
    cache: Map<ts.Type, Shared>;
};
/**
 * A converted subtree that came out the same wherever it appeared, so it can be
 * handed out again instead of walked again. The same object is reused, not a
 * copy: a schema is a value, nothing in this package mutates one.
 */
type Shared = {
    schema: Schema;
    /** Frames it needs below it, so it is only reused where that depth is left. */
    height: number;
};
export declare function createSchemaRegistry(): SchemaRegistry;
export declare function convertTypeToSchema(type: ts.Type, checker: ts.TypeChecker, registry: SchemaRegistry): Schema;
export {};
