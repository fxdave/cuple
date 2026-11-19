import * as ts from "typescript";
import type { InspectResult } from "./types";
/**
 * The routes of `variableName`, plus the named definitions their
 * `{ type: "ref" }` nodes point at, which a recursive type is described as.
 */
export declare function inspectRoutes(filePath: string, variableName: string, options?: {
    tsconfigPath?: string;
}): InspectResult;
/** {@link inspectRoutes} against a program you already have. */
export declare function inspectRoutesFromProgram(program: ts.Program, sourceFile: ts.SourceFile, variableName: string): InspectResult;
