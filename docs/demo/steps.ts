/**
 * The homepage demo's story: the backend adds a required query parameter, and
 * the frontend's call turns red until it sends it. Each step is what a person
 * would do in the editor; `generate.ts` asks TypeScript what the editor shows.
 */
export type FileName = "backend" | "frontend";

/** A place in a file: the end (or `at: "start"`, or an offset) of the `occurrence`th `find`. */
export type Anchor = { find: string; occurrence?: number; at?: "start" | "end" | number };

export type Step =
  | { wait: number }
  | { browser: { input?: string; message?: string; pressed?: boolean } }
  | { file: FileName; cursor: Anchor }
  | { file: FileName; select: Omit<Anchor, "at"> }
  | { file: FileName; type: string; perChar?: number }
  | { file: FileName; suggest: true }
  | { file: FileName; accept: string }
  | { file: FileName; signature: true }
  | { file: FileName; hover: Anchor }
  | { file: FileName; close: true };

/** Types `text` into the browser's input, one character at a time. */
function typeInBrowser(text: string): Step[] {
  return [...text].flatMap((_, i) => [
    { browser: { input: text.slice(0, i + 1) } },
    { wait: 90 },
  ]);
}

export const steps: Step[] = [
  { wait: 800 },
  // The app works: the button says hi.
  ...typeInBrowser("David"),
  { wait: 400 },
  { browser: { pressed: true } },
  { wait: 150 },
  { browser: { pressed: false, message: "Hi!" } },
  { wait: 1500 },

  // The backend wants a name.
  { file: "backend", cursor: { find: "success } from \"@cuple/server\";" } },
  { wait: 400 },
  { file: "backend", type: '\nimport { z } from "zod";', perChar: 35 },
  { file: "backend", cursor: { find: "sayHi: builder" } },
  { wait: 400 },
  { file: "backend", type: "\n    ." },
  { file: "backend", suggest: true },
  { wait: 700 },
  { file: "backend", type: "que", perChar: 140 },
  { wait: 500 },
  { file: "backend", accept: "querySchema" },
  { file: "backend", type: "(" },
  { file: "backend", signature: true },
  { wait: 1400 },
  { file: "backend", close: true },
  { file: "backend", type: "z." },
  { file: "backend", suggest: true },
  { wait: 500 },
  { file: "backend", type: "str", perChar: 140 },
  { wait: 500 },
  { file: "backend", accept: "strictObject" },
  { file: "backend", type: "({ name: z." },
  { file: "backend", suggest: true },
  { wait: 400 },
  { file: "backend", type: "str", perChar: 140 },
  { wait: 300 },
  { file: "backend", accept: "string" },
  { file: "backend", type: "().min(2) }))" },
  { wait: 600 },

  // ...and uses it.
  { file: "backend", cursor: { find: "async (", at: "end" } },
  { file: "backend", type: "{ data }" },
  { wait: 400 },
  { file: "backend", select: { find: '"Hi!"' } },
  { wait: 400 },
  { file: "backend", type: "`Hi ${data." },
  { file: "backend", suggest: true },
  { wait: 900 },
  { file: "backend", type: "q", perChar: 140 },
  { wait: 300 },
  { file: "backend", accept: "query" },
  { file: "backend", type: "." },
  { file: "backend", suggest: true },
  { wait: 800 },
  { file: "backend", accept: "name" },
  { file: "backend", type: "}!`" },
  { wait: 1200 },

  // The frontend didn't change, and now it's wrong.
  { file: "frontend", hover: { find: "client.sayHi.get, {}", at: 18 } },
  { wait: 3200 },
  { file: "frontend", close: true },
  { file: "frontend", cursor: { find: "client.sayHi.get, {", at: "end" } },
  { file: "frontend", type: " " },
  { file: "frontend", suggest: true },
  { wait: 1200 },
  { file: "frontend", type: "q", perChar: 140 },
  { wait: 300 },
  { file: "frontend", accept: "query" },
  { file: "frontend", type: ": { name } " },
  { wait: 1400 },

  // Fixed, and it works.
  { browser: { input: "", message: "" } },
  { wait: 500 },
  ...typeInBrowser("David"),
  { wait: 400 },
  { browser: { pressed: true } },
  { wait: 150 },
  { browser: { pressed: false, message: "Hi David!" } },
  { wait: 3000 },
];
