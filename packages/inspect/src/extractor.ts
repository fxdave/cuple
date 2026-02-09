import * as ts from "typescript";
import * as path from "path";
import { RouteInfo, ResponseVariant, Schema } from "./types";
import { parsePath } from "./path-parser";
import { convertTypeToSchema } from "./schema-converter";
import { extractResponseVariants } from "./response-extractor";

export function inspectRoutes(
  filePath: string,
  variableName: string,
  options?: { tsconfigPath?: string },
): RouteInfo[] {
  const resolvedPath = path.resolve(filePath);
  const configPath = options?.tsconfigPath
    ? path.resolve(options.tsconfigPath)
    : findTsConfig(resolvedPath);

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Error reading tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );

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

export function inspectRoutesFromProgram(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  variableName: string,
): RouteInfo[] {
  const checker = program.getTypeChecker();

  const variableDecl = findVariable(sourceFile, variableName);
  if (!variableDecl) {
    throw new Error(`Variable "${variableName}" not found in source file`);
  }

  const variableType = checker.getTypeAtLocation(variableDecl);
  return extractRoutesFromType(variableType, variableDecl, sourceFile, "", checker);
}

function findTsConfig(filePath: string): string {
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

function findVariable(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function extractRoutesFromType(
  type: ts.Type,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  prefix: string,
  checker: ts.TypeChecker,
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const properties = type.getProperties();

  for (const prop of properties) {
    const propName = prop.getName();
    const fullName = prefix ? `${prefix}.${propName}` : propName;
    const propType = checker.getTypeOfSymbolAtLocation(prop, node);

    // Check if this is a BuiltEndpoint by looking for _method property
    const methodProp = propType.getProperty("_method");

    if (methodProp) {
      const routeInfo = extractRouteInfo(prop, propType, node, fullName, checker);
      if (routeInfo) {
        routes.push(routeInfo);
      }
    } else {
      // Nested object, recurse
      const nestedRoutes = extractRoutesFromType(
        propType,
        node,
        sourceFile,
        fullName,
        checker,
      );
      routes.push(...nestedRoutes);
    }
  }

  return routes;
}

function extractRouteInfo(
  symbol: ts.Symbol,
  routeType: ts.Type,
  node: ts.Node,
  name: string,
  checker: ts.TypeChecker,
): RouteInfo | null {
  // Extract path from AST
  const pathValue = extractPathFromSymbol(symbol);
  if (!pathValue) {
    return null;
  }

  // Extract method from tMethod
  const methodProp = routeType.getProperty("tMethod");
  let method = "get";
  if (methodProp) {
    const methodType = checker.getTypeOfSymbolAtLocation(methodProp, node);
    if (methodType.isStringLiteral()) {
      method = methodType.value;
    }
  }

  // Extract metadata from tMeta
  const metaProp = routeType.getProperty("tMeta");
  let description: string | undefined;
  if (metaProp) {
    const metaType = checker.getTypeOfSymbolAtLocation(metaProp, node);
    const descProp = metaType.getProperty("description");
    if (descProp) {
      const descType = checker.getTypeOfSymbolAtLocation(descProp, node);
      if (descType.isStringLiteral()) {
        description = descType.value;
      }
    }
  }

  // Extract input fields
  const inputProp = routeType.getProperty("tInput");
  let bodySchema: Schema | null = null;
  let querySchema: Schema | null = null;
  let paramsSchema: Schema | null = null;
  let headersSchema: Schema | null = null;

  if (inputProp) {
    const inputType = checker.getTypeOfSymbolAtLocation(inputProp, node);
    const inputFields = extractInputFields(inputType, checker);

    if (inputFields.body) {
      bodySchema = convertTypeToSchema(inputFields.body, checker);
    }
    if (inputFields.query) {
      querySchema = convertTypeToSchema(inputFields.query, checker);
    }
    if (inputFields.params) {
      paramsSchema = convertTypeToSchema(inputFields.params, checker);
    }
    if (inputFields.headers) {
      headersSchema = convertTypeToSchema(inputFields.headers, checker);
    }
  }

  // Extract response variants from tOutput
  const outputProp = routeType.getProperty("tOutput");
  let response: ResponseVariant[] = [];
  if (outputProp) {
    const outputType = checker.getTypeOfSymbolAtLocation(outputProp, node);
    response = extractResponseVariants(outputType, checker);
  }

  return {
    name,
    description,
    path: parsePath(pathValue),
    method,
    bodySchema,
    querySchema,
    paramsSchema,
    headersSchema,
    response,
  };
}

function extractPathFromSymbol(symbol: ts.Symbol): string | null {
  const valueDecl = symbol.valueDeclaration;
  if (!valueDecl) return null;

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
    if (originalDecl?.initializer) {
      return findPathCallInExpression(originalDecl.initializer);
    }
  }

  // Handle direct variable declarations (e.g. const route = builder.path(...).get(...))
  if (ts.isVariableDeclaration(valueDecl) && valueDecl.initializer) {
    return findPathCallInExpression(valueDecl.initializer);
  }

  return null;
}

function findVariableDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function findPathCallInExpression(node: ts.Node): string | null {
  if (ts.isCallExpression(node)) {
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "path"
    ) {
      if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
        return node.arguments[0].text;
      }
    }

    const pathInExpression = findPathCallInExpression(node.expression);
    if (pathInExpression) return pathInExpression;
  }

  if (ts.isPropertyAccessExpression(node)) {
    return findPathCallInExpression(node.expression);
  }

  return null;
}

interface InputFields {
  body?: ts.Type;
  query?: ts.Type;
  params?: ts.Type;
  headers?: ts.Type;
}

function extractInputFields(inputType: ts.Type, checker: ts.TypeChecker): InputFields {
  const fields: InputFields = {};
  const properties = inputType.getProperties();

  for (const prop of properties) {
    const propName = prop.getName();
    if (
      propName === "body" ||
      propName === "query" ||
      propName === "params" ||
      propName === "headers"
    ) {
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
