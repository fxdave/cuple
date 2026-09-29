import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * What an editor suggests while writing a handler and calling it. Types can be
 * correct and still complete badly (a computed key is offered as `[Key]`), so
 * this asks the language service with the preferences VS Code sends.
 */
const repo = path.resolve(__dirname, "../../..");
const file = path.join(repo, "test/src/core/__completions__.ts");

function completionsAt(source: string, marker = "/**/") {
  const position = source.indexOf(marker);
  const text = source.replace(marker, "");
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    paths: {
      "@cuple/client": [path.join(repo, "packages/client/src/index.ts")],
      "@cuple/server": [path.join(repo, "packages/server/src/index.ts")],
    },
  };
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => "0",
    getScriptSnapshot: (name) => {
      const content = name === file ? text : ts.sys.readFile(name);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => repo,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (name) => name === file || ts.sys.fileExists(name),
    readFile: (name) => (name === file ? text : ts.sys.readFile(name)),
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  });
  const result = service.getCompletionsAtPosition(file, position, {
    includeCompletionsWithInsertText: true,
  });
  return (result?.entries ?? []).map((entry) => entry.insertText ?? entry.name);
}

const routes = `
import express from "express";
import { z } from "zod";
import { createBuilder, success } from "@cuple/server";
import { createClient, fetchCuple } from "@cuple/client";

const builder = createBuilder(express());
const routes = {
  sayHi: builder
    .querySchema(z.object({ name: z.string() }))
    .paramsSchema(z.object({ id: z.string() }))
    .headersSchema(z.object({ authorization: z.string() }))
    .bodySchema(z.object({ text: z.string() }))
    .post(async ({ data }) => {
      HANDLER
      return success({ message: "hi" });
    }),
};
const client = createClient<typeof routes>({ path: "/rpc" });
CALL
`;

// Each case starts a language service over zod and express: slow on a busy machine.
describe("editor completions", { timeout: 30_000 }, () => {
  it("suggests the parsed request parts on `data.` in a handler", () => {
    const names = completionsAt(
      routes.replace("HANDLER", "data./**/").replace("CALL", ""),
    );
    expect(names).toEqual(expect.arrayContaining(["query", "params", "headers", "body"]));
    expect(names.some((name) => name.startsWith("["))).toBe(false);
  });

  it("suggests `query` with only a query schema", () => {
    const source = routes
      .replace(/ {4}\.paramsSchema.*\n {4}\.headersSchema.*\n {4}\.bodySchema.*\n/, "")
      .replace("HANDLER", "data./**/")
      .replace("CALL", "");
    expect(source).not.toContain("bodySchema");
    const names = completionsAt(source);
    expect(names).toContain("query");
    expect(names.some((name) => name.startsWith("["))).toBe(false);
  });

  it("suggests the request parts in a call's options", () => {
    const names = completionsAt(
      routes
        .replace("HANDLER", "")
        .replace("CALL", "fetchCuple(client.sayHi.post, { /**/ });"),
    );
    expect(names).toEqual(expect.arrayContaining(["query", "params", "headers", "body"]));
    expect(names.some((name) => name.startsWith("["))).toBe(false);
  });
});
