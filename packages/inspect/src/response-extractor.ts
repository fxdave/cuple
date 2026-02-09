import * as ts from "typescript";
import { ResponseVariant, PropertyInfo } from "./types";
import { convertTypeToSchema } from "./schema-converter";

const EXCLUDED_PROPS = new Set(["result", "statusCode", "next"]);

export function extractResponseVariants(
  outputType: ts.Type,
  checker: ts.TypeChecker,
): ResponseVariant[] {
  const variants: ResponseVariant[] = [];

  if (outputType.isUnion()) {
    for (const memberType of outputType.types) {
      const variant = extractSingleVariant(memberType, checker);
      if (variant) {
        variants.push(variant);
      }
    }
  } else {
    const variant = extractSingleVariant(outputType, checker);
    if (variant) {
      variants.push(variant);
    }
  }

  // Deduplicate variants with same result value
  return deduplicateVariants(variants);
}

function extractSingleVariant(
  type: ts.Type,
  checker: ts.TypeChecker,
): ResponseVariant | null {
  // Skip if this has next: true (middleware pass-through, not a response)
  const nextProp = type.getProperty("next");
  if (nextProp) {
    const nextType = checker.getTypeOfSymbol(nextProp);
    if (
      nextType.flags & ts.TypeFlags.BooleanLiteral &&
      checker.typeToString(nextType) === "true"
    ) {
      return null;
    }
  }

  let result: string | null = null;
  let statusCode: number | null = null;
  const properties: Record<string, PropertyInfo> = {};

  const allProperties = type.getProperties();

  for (const prop of allProperties) {
    const propName = prop.getName();

    if (propName === "result") {
      const propType = checker.getTypeOfSymbol(prop);
      if (propType.isStringLiteral()) {
        result = propType.value;
      }
      continue;
    }

    if (propName === "statusCode") {
      const propType = checker.getTypeOfSymbol(prop);
      if (propType.isNumberLiteral()) {
        statusCode = propType.value;
      }
      continue;
    }

    if (EXCLUDED_PROPS.has(propName)) continue;

    const propType = checker.getTypeOfSymbol(prop);
    const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

    properties[propName] = {
      schema: convertTypeToSchema(propType, checker),
      required: !isOptional,
    };
  }

  return { result, statusCode, properties };
}

function deduplicateVariants(variants: ResponseVariant[]): ResponseVariant[] {
  const seen = new Map<string, ResponseVariant>();

  for (const variant of variants) {
    const key = `${variant.result ?? "__null__"}:${variant.statusCode ?? "__null__"}`;
    if (!seen.has(key)) {
      seen.set(key, variant);
    }
  }

  return Array.from(seen.values());
}
