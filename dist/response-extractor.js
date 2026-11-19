"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractResponseVariants = extractResponseVariants;
const ts = __importStar(require("typescript"));
const schema_converter_1 = require("./schema-converter");
const EXCLUDED_PROPS = new Set(["result", "statusCode", "next"]);
function extractResponseVariants(outputType, checker, registry) {
    const variants = [];
    if (outputType.isUnion()) {
        for (const memberType of outputType.types) {
            const variant = extractSingleVariant(memberType, checker, registry);
            if (variant) {
                variants.push(variant);
            }
        }
    }
    else {
        const variant = extractSingleVariant(outputType, checker, registry);
        if (variant) {
            variants.push(variant);
        }
    }
    // Deduplicate variants with same result value
    return deduplicateVariants(variants);
}
function extractSingleVariant(type, checker, registry) {
    // Skip if this has next: true (middleware pass-through, not a response)
    const nextProp = type.getProperty("next");
    if (nextProp) {
        const nextType = checker.getTypeOfSymbol(nextProp);
        if (nextType.flags & ts.TypeFlags.BooleanLiteral &&
            checker.typeToString(nextType) === "true") {
            return null;
        }
    }
    let result = null;
    let statusCode = null;
    const properties = {};
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
        if (EXCLUDED_PROPS.has(propName))
            continue;
        const propType = checker.getTypeOfSymbol(prop);
        const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
        properties[propName] = {
            schema: (0, schema_converter_1.convertTypeToSchema)(propType, checker, registry),
            required: !isOptional,
        };
    }
    return { result, statusCode, properties };
}
function deduplicateVariants(variants) {
    var _a, _b;
    const seen = new Map();
    for (const variant of variants) {
        const key = `${(_a = variant.result) !== null && _a !== void 0 ? _a : "__null__"}:${(_b = variant.statusCode) !== null && _b !== void 0 ? _b : "__null__"}`;
        if (!seen.has(key)) {
            seen.set(key, variant);
        }
    }
    return Array.from(seen.values());
}
//# sourceMappingURL=response-extractor.js.map