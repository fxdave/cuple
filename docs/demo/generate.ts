/**
 * Records the homepage demo: plays the steps in `steps.ts` against the files in
 * `project/`, and asks the real TypeScript language service, with the real
 * `@cuple/*` types, what an editor would show at each point (errors,
 * completions, hovers). The result is `src/components/TypeSafetyDemo/timeline.json`,
 * which the homepage plays back.
 *
 * Run from the repo root, after `npm run build`:
 *
 *   npx tsx docs/demo/generate.ts
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { type Anchor, type FileName, steps } from "./steps";

const repo = path.resolve(__dirname, "../..");
// The project is served from a virtual folder at the repo root, so imports
// resolve to the workspace's packages the way a user's app would.
const virtualRoot = path.join(repo, ".cuple-demo");
const shown: Record<FileName, string> = {
  backend: "backend/index.ts",
  frontend: "frontend/App.tsx",
};
const hidden = ["frontend/cuple.ts"];

const files = new Map<string, { text: string; version: number }>();
for (const name of [...Object.values(shown), ...hidden])
  files.set(path.join(virtualRoot, name), {
    text: fs.readFileSync(path.join(__dirname, "project", name), "utf8"),
    version: 0,
  });

const options: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  skipLibCheck: true,
  noEmit: true,
};

const service = ts.createLanguageService(
  {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
    getScriptSnapshot: (f) => {
      const text = files.get(f)?.text ?? ts.sys.readFile(f);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => repo,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f)?.text ?? ts.sys.readFile(f),
    readDirectory: ts.sys.readDirectory,
    directoryExists: (d) => d.startsWith(virtualRoot) || ts.sys.directoryExists(d),
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  },
  ts.createDocumentRegistry(),
);

/** What VS Code asks TypeScript for; without it, some members aren't offered. */
const preferences: ts.UserPreferences = { includeCompletionsWithInsertText: true };

const fullPath = (file: FileName) => path.join(virtualRoot, shown[file]);
const text = (file: FileName) => files.get(fullPath(file))!.text;

function edit(file: FileName, from: number, to: number, insert: string) {
  const entry = files.get(fullPath(file))!;
  entry.text = entry.text.slice(0, from) + insert + entry.text.slice(to);
  entry.version++;
}

function locate(file: FileName, anchor: Anchor): number {
  const source = text(file);
  let index = -1;
  for (let i = 0; i <= (anchor.occurrence ?? 0); i++) {
    index = source.indexOf(anchor.find, index + 1);
    if (index === -1) throw new Error(`"${anchor.find}" not found in ${file}`);
  }
  if (anchor.at === "start") return index;
  if (typeof anchor.at === "number") return index + anchor.at;
  return index + anchor.find.length;
}

type Diagnostic = { start: number; length: number; message: string };
function diagnostics(file: FileName): Diagnostic[] {
  const f = fullPath(file);
  return [...service.getSyntacticDiagnostics(f), ...service.getSemanticDiagnostics(f)].map(
    (d) => ({
      start: d.start ?? 0,
      length: Math.max(d.length ?? 1, 1),
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }),
  );
}

/** How TypeScript prints a declaration, cut to what fits in a popup. */
function display(parts: ts.SymbolDisplayPart[] | undefined) {
  return ts.displayPartsToString(parts).replace(/\s+/g, " ").trim();
}

type Event = { d: number } & (
  | { k: "focus"; file: FileName }
  | { k: "cursor"; file: FileName; pos: number }
  | { k: "select"; file: FileName; from: number; to: number }
  | { k: "edit"; file: FileName; from: number; to: number; text: string }
  | { k: "diagnostics"; file: FileName; items: Diagnostic[] }
  | {
      k: "completions";
      file: FileName;
      pos: number;
      items: { name: string; kind: string }[];
      selected: number;
      detail: string;
    }
  | { k: "info"; file: FileName; pos: number; text: string; error?: boolean }
  | { k: "close" }
  | { k: "browser"; input?: string; message?: string; pressed?: boolean }
);

const events: Event[] = [];
let delay = 0;
const emit = (event: Event) => {
  events.push(event);
  delay = 0;
};
let popupOpen = false;
const wait = (ms: number) => {
  // Errors show up when typing pauses, like an editor's debounced check.
  if (ms >= 500 && completionStart === null && !popupOpen) publishDiagnostics();
  delay += ms;
};

let focused: FileName = "backend";
const cursor: Record<FileName, number> = { backend: 0, frontend: 0 };
const selection: Record<FileName, [number, number] | null> = {
  backend: null,
  frontend: null,
};
let lastDiagnostics = "";

/** Publishes both files' errors, like an editor after a pause in typing. */
function publishDiagnostics() {
  const now = JSON.stringify([diagnostics("backend"), diagnostics("frontend")]);
  if (now === lastDiagnostics) return;
  lastDiagnostics = now;
  for (const file of ["backend", "frontend"] as const)
    emit({ d: delay, k: "diagnostics", file, items: diagnostics(file) });
}

/** The completion popup's content for what's been typed since it opened. */
function completions(file: FileName, start: number) {
  const pos = cursor[file];
  const typed = text(file).slice(start, pos);
  const all = service.getCompletionsAtPosition(fullPath(file), start, preferences) ?? {
    entries: [],
  };
  const matching = all.entries
    .filter((e) => e.name.toLowerCase().startsWith(typed.toLowerCase()))
    .filter((e) => !e.name.startsWith("__"))
    .sort((a, b) => a.sortText.localeCompare(b.sortText) || a.name.localeCompare(b.name));
  const first = matching[0];
  const details = first
    ? service.getCompletionEntryDetails(
        fullPath(file),
        start,
        first.name,
        {},
        first.source,
        preferences,
        first.data,
      )
    : undefined;
  return {
    items: matching.slice(0, 8).map((e) => ({ name: e.name, kind: e.kind })),
    detail: display(details?.displayParts),
  };
}

let completionStart: number | null = null;

/** Like an editor's auto-closing brackets and quotes. */
const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]", '"': '"', "`": "`" };
const closers = new Set(Object.values(pairs));

function typeText(file: FileName, value: string, perChar: number) {
  for (const char of value) {
    const replacing = selection[file];
    const [from, to] = replacing ?? [cursor[file], cursor[file]];
    selection[file] = null;
    if (!replacing && closers.has(char) && text(file)[from] === char) {
      // Typing the closer that was auto-inserted steps over it.
      cursor[file] = from + 1;
      emit({ d: delay, k: "cursor", file, pos: cursor[file] });
    } else {
      // Typing an opener over a selection replaces it with the pair.
      const insert = pairs[char] ? char + pairs[char] : char;
      edit(file, from, to, insert);
      cursor[file] = from + 1;
      emit({ d: delay, k: "edit", file, from, to, text: insert });
      if (insert.length > 1) emit({ d: 0, k: "cursor", file, pos: cursor[file] });
    }
    wait(perChar);
    if (completionStart !== null) {
      if (!/[\w$]/.test(char)) {
        completionStart = null;
        emit({ d: delay, k: "close" });
      } else {
        const list = completions(file, completionStart);
        if (list.items.length === 0) {
          completionStart = null;
          emit({ d: delay, k: "close" });
        } else emit({ d: delay, k: "completions", file, pos: completionStart, selected: 0, ...list });
      }
    }
  }
}

for (const [index, step] of steps.entries()) {
  try {
    runStep(step);
  } catch (error) {
    throw new Error(`step ${index} ${JSON.stringify(step)}: ${(error as Error).message}`);
  }
}

function runStep(step: (typeof steps)[number]) {
  if ("wait" in step) {
    wait(step.wait);
    return;
  }
  if ("browser" in step) {
    emit({ d: delay, k: "browser", ...step.browser });
    return;
  }
  const file = step.file;
  if (file !== focused) {
    focused = file;
    emit({ d: delay, k: "focus", file });
  }
  if ("cursor" in step) {
    cursor[file] = locate(file, step.cursor);
    emit({ d: delay, k: "cursor", file, pos: cursor[file] });
  } else if ("select" in step) {
    const from = locate(file, { ...step.select, at: "start" });
    const to = from + step.select.find.length;
    selection[file] = [from, to];
    cursor[file] = to;
    emit({ d: delay, k: "select", file, from, to });
  } else if ("type" in step) {
    typeText(file, step.type, step.perChar ?? 70);
  } else if ("suggest" in step) {
    completionStart = cursor[file];
    emit({ d: delay, k: "completions", file, pos: completionStart, selected: 0, ...completions(file, completionStart) });
  } else if ("accept" in step) {
    if (completionStart === null) throw new Error("accept without an open completion list");
    const typed = text(file).slice(completionStart, cursor[file]);
    const start = completionStart;
    completionStart = null;
    emit({ d: delay, k: "close" });
    if (!step.accept.startsWith(typed))
      throw new Error(`"${step.accept}" doesn't continue "${typed}"`);
    const rest = step.accept.slice(typed.length);
    edit(file, cursor[file], cursor[file], rest);
    emit({ d: delay, k: "edit", file, from: cursor[file], to: cursor[file], text: rest });
    cursor[file] = start + step.accept.length;
  } else if ("signature" in step) {
    const help = service.getSignatureHelpItems(fullPath(file), cursor[file], undefined);
    const item = help?.items[help.selectedItemIndex];
    if (!item) throw new Error("no signature help here");
    // The parameters, without the (long) return type.
    const signature = `${display([
      ...item.prefixDisplayParts,
      ...item.parameters.flatMap((p, i) => [
        ...(i > 0 ? item.separatorDisplayParts : []),
        ...p.displayParts,
      ]),
    ])})`;
    popupOpen = true;
    emit({ d: delay, k: "info", file, pos: cursor[file], text: signature });
  } else if ("hover" in step) {
    const pos = locate(file, step.hover);
    cursor[file] = pos;
    emit({ d: delay, k: "cursor", file, pos });
    const diagnostic = diagnostics(file).find((d) => pos >= d.start && pos <= d.start + d.length);
    popupOpen = true;
    if (diagnostic) emit({ d: delay, k: "info", file, pos, text: diagnostic.message, error: true });
    else {
      const info = service.getQuickInfoAtPosition(fullPath(file), pos);
      if (!info) throw new Error("nothing to show on hover here");
      emit({ d: delay, k: "info", file, pos, text: display(info.displayParts) });
    }
  } else if ("close" in step) {
    completionStart = null;
    popupOpen = false;
    emit({ d: delay, k: "close" });
  }
}

publishDiagnostics();

// The story only makes sense if the end state compiles, and the files stay honest.
for (const file of ["backend", "frontend"] as const) {
  const left = diagnostics(file);
  if (left.length) throw new Error(`${file} ends with errors: ${left.map((d) => d.message).join("; ")}`);
}

const initial = Object.fromEntries(
  (Object.keys(shown) as FileName[]).map((f) => [
    f,
    fs.readFileSync(path.join(__dirname, "project", shown[f]), "utf8"),
  ]),
);
const out = path.join(__dirname, "../src/components/TypeSafetyDemo/timeline.json");
fs.writeFileSync(
  out,
  `${JSON.stringify({ files: { backend: "backend/index.ts", frontend: "frontend/App.tsx" }, initial, events })}\n`,
);
console.log(`${events.length} events, ${Math.round(events.reduce((s, e) => s + e.d, 0) / 1000)}s → ${path.relative(repo, out)}`);
