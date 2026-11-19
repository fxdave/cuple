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
exports.inspectRoutes = inspectRoutes;
exports.inspectRoutesFromProgram = inspectRoutesFromProgram;
const path = __importStar(require("node:path"));
const ts = __importStar(require("typescript"));
const path_parser_1 = require("./path-parser");
const response_extractor_1 = require("./response-extractor");
const schema_converter_1 = require("./schema-converter");
/**
 * The routes of `variableName`, plus the named definitions their
 * `{ type: "ref" }` nodes point at, which a recursive type is described as.
 */
function inspectRoutes(filePath, variableName, options) {
    const resolvedPath = path.resolve(filePath);
    const configPath = (options === null || options === void 0 ? void 0 : options.tsconfigPath)
        ? path.resolve(options.tsconfigPath)
        : findTsConfig(resolvedPath);
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(`Error reading tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`);
    }
    const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    const program = ts.createProgram({
        rootNames: [resolvedPath],
        options: parsedConfig.options,
    });
    const sourceFile = program.getSourceFile(resolvedPath);
    if (!sourceFile) {
        throw new Error(`Could not load source file: ${resolvedPath}`);
    }
    return inspectRoutesFromProgram(program, sourceFile, variableName);
}
/** {@link inspectRoutes} against a program you already have. */
function inspectRoutesFromProgram(program, sourceFile, variableName) {
    const checker = program.getTypeChecker();
    const variableDecl = findVariable(sourceFile, variableName);
    if (!variableDecl) {
        throw new Error(`Variable "${variableName}" not found in source file`);
    }
    // One registry for the whole inspection, so a recursive type shared by
    // several routes is described once.
    const registry = (0, schema_converter_1.createSchemaRegistry)();
    const variableType = checker.getTypeAtLocation(variableDecl);
    const routes = extractRoutesFromType(variableType, variableDecl, sourceFile, "", checker, registry);
    return { routes, definitions: registry.definitions };
}
function findTsConfig(filePath) {
    let dir = path.dirname(filePath);
    while (dir !== path.dirname(dir)) {
        const configPath = path.join(dir, "tsconfig.json");
        if (ts.sys.fileExists(configPath)) {
            return configPath;
        }
        dir = path.dirname(dir);
    }
    throw new Error("Could not find tsconfig.json");
}
function findVariable(sourceFile, name) {
    let found = null;
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}
function extractRoutesFromType(type, node, sourceFile, prefix, checker, registry) {
    const routes = [];
    const properties = type.getProperties();
    for (const prop of properties) {
        const propName = prop.getName();
        const fullName = prefix ? `${prefix}.${propName}` : propName;
        const propType = checker.getTypeOfSymbolAtLocation(prop, node);
        // Check if this is a BuiltEndpoint by looking for _method property
        const methodProp = propType.getProperty("_method");
        if (methodProp) {
            routes.push(extractRouteInfo(prop, propType, node, fullName, checker, registry));
        }
        else {
            // Nested object, recurse
            const nestedRoutes = extractRoutesFromType(propType, node, sourceFile, fullName, checker, registry);
            routes.push(...nestedRoutes);
        }
    }
    return routes;
}
function extractRouteInfo(symbol, routeType, node, name, checker, registry) {
    // Extract path from AST
    const pathValue = extractPathFromSymbol(symbol);
    // Extract method from tMethod
    const methodProp = routeType.getProperty("tMethod");
    let method = "get";
    if (methodProp) {
        const methodType = checker.getTypeOfSymbolAtLocation(methodProp, node);
        if (methodType.isStringLiteral()) {
            method = methodType.value;
        }
    }
    // Extract metadata from tMeta: every field with a literal value.
    const metaProp = routeType.getProperty("tMeta");
    const meta = {};
    if (metaProp) {
        const metaType = checker.getTypeOfSymbolAtLocation(metaProp, node);
        for (const field of metaType.getProperties()) {
            const fieldType = checker.getTypeOfSymbolAtLocation(field, node);
            if (fieldType.isStringLiteral() || fieldType.isNumberLiteral()) {
                meta[field.name] = fieldType.value;
            }
            else if (fieldType.flags & ts.TypeFlags.BooleanLiteral) {
                meta[field.name] = checker.typeToString(fieldType) === "true";
            }
        }
    }
    const description = typeof meta.description === "string" ? meta.description : undefined;
    // Extract input fields
    const inputProp = routeType.getProperty("tInput");
    let bodySchema = null;
    let querySchema = null;
    let paramsSchema = null;
    let headersSchema = null;
    if (inputProp) {
        const inputType = checker.getTypeOfSymbolAtLocation(inputProp, node);
        const inputFields = extractInputFields(inputType, checker);
        if (inputFields.body) {
            bodySchema = (0, schema_converter_1.convertTypeToSchema)(inputFields.body, checker, registry);
        }
        if (inputFields.query) {
            querySchema = (0, schema_converter_1.convertTypeToSchema)(inputFields.query, checker, registry);
        }
        if (inputFields.params) {
            paramsSchema = (0, schema_converter_1.convertTypeToSchema)(inputFields.params, checker, registry);
        }
        if (inputFields.headers) {
            headersSchema = (0, schema_converter_1.convertTypeToSchema)(inputFields.headers, checker, registry);
        }
    }
    // Extract response variants from tOutput
    const outputProp = routeType.getProperty("tOutput");
    let response = [];
    if (outputProp) {
        const outputType = checker.getTypeOfSymbolAtLocation(outputProp, node);
        response = (0, response_extractor_1.extractResponseVariants)(outputType, checker, registry);
    }
    return {
        name,
        description,
        meta,
        path: pathValue === null ? null : (0, path_parser_1.parsePath)(pathValue),
        method,
        bodySchema,
        querySchema,
        paramsSchema,
        headersSchema,
        response,
    };
}
function extractPathFromSymbol(symbol) {
    const valueDecl = symbol.valueDeclaration;
    if (!valueDecl)
        return null;
    if (ts.isPropertyAssignment(valueDecl)) {
        return findPathCallInExpression(valueDecl.initializer);
    }
    // Handle shorthand property assignments: { getHealth } -> resolve to original variable
    if (ts.isShorthandPropertyAssignment(valueDecl)) {
        // The name of the shorthand property is the same as the variable it references
        // Walk up to find the original variable declaration
        const sourceFile = valueDecl.getSourceFile();
        const varName = valueDecl.name.text;
        const originalDecl = findVariableDeclaration(sourceFile, varName);
        if (originalDecl === null || originalDecl === void 0 ? void 0 : originalDecl.initializer) {
            return findPathCallInExpression(originalDecl.initializer);
        }
    }
    // Handle direct variable declarations (e.g. const route = builder.path(...).get(...))
    if (ts.isVariableDeclaration(valueDecl) && valueDecl.initializer) {
        return findPathCallInExpression(valueDecl.initializer);
    }
    return null;
}
function findVariableDeclaration(sourceFile, name) {
    let found = null;
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}
function findPathCallInExpression(node) {
    if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "path") {
            if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                return node.arguments[0].text;
            }
        }
        const pathInExpression = findPathCallInExpression(node.expression);
        if (pathInExpression)
            return pathInExpression;
    }
    if (ts.isPropertyAccessExpression(node)) {
        return findPathCallInExpression(node.expression);
    }
    return null;
}
function extractInputFields(inputType, checker) {
    const fields = {};
    const properties = inputType.getProperties();
    for (const prop of properties) {
        const propName = prop.getName();
        if (propName === "body" ||
            propName === "query" ||
            propName === "params" ||
            propName === "headers") {
            const propType = checker.getTypeOfSymbol(prop);
            // Skip undefined types
            if (propType.flags & ts.TypeFlags.Undefined) {
                continue;
            }
            fields[propName] = propType;
        }
    }
    return fields;
}
//# sourceMappingURL=extractor.js.map