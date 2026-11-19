import * as ts from "typescript";
import { type SchemaRegistry } from "./schema-converter";
import type { ResponseVariant } from "./types";
export declare function extractResponseVariants(outputType: ts.Type, checker: ts.TypeChecker, registry: SchemaRegistry): ResponseVariant[];
