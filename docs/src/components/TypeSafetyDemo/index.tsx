import { Highlight, type Token, themes } from "prism-react-renderer";
import { type CSSProperties, type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import styles from "./styles.module.css";
import timeline from "./timeline.json";

/**
 * Plays back `timeline.json`: an edit to the backend's schema, and what
 * TypeScript shows in the frontend because of it. Every error, completion and
 * hover was produced by the TypeScript language service on the real packages
 * (see `docs/demo/generate.ts`); this only replays them.
 */

type FileName = "backend" | "frontend";
type Diagnostic = { start: number; length: number; message: string };
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

const events = timeline.events as Event[];
const fileNames = timeline.files as Record<FileName, string>;

type FileState = {
  text: string;
  cursor: number;
  selection: [number, number] | null;
  diagnostics: Diagnostic[];
};
type Popup =
  | (Extract<Event, { k: "completions" }> & { kind: "completions" })
  | (Extract<Event, { k: "info" }> & { kind: "info" });
type State = {
  step: number;
  files: Record<FileName, FileState>;
  focus: FileName | null;
  popup: Popup | null;
  browser: { visible: boolean; input: string; message: string; pressed: boolean };
};

function initialState(): State {
  const file = (name: FileName): FileState => ({
    text: timeline.initial[name],
    cursor: 0,
    selection: null,
    diagnostics: [],
  });
  return {
    step: 0,
    files: { backend: file("backend"), frontend: file("frontend") },
    focus: null,
    popup: null,
    browser: { visible: true, input: "", message: "", pressed: false },
  };
}

function apply(state: State, event: Event): State {
  const next: State = { ...state, step: state.step + 1 };
  const update = (file: FileName, change: Partial<FileState>) => {
    next.files = { ...next.files, [file]: { ...next.files[file], ...change } };
  };
  // Anything happening in an editor brings the editors back.
  if (event.k !== "browser" && event.k !== "diagnostics")
    next.browser = { ...next.browser, visible: false };
  switch (event.k) {
    case "focus":
      next.focus = event.file;
      break;
    case "cursor":
      next.focus = event.file;
      update(event.file, { cursor: event.pos, selection: null });
      break;
    case "select":
      next.focus = event.file;
      update(event.file, { cursor: event.to, selection: [event.from, event.to] });
      break;
    case "edit": {
      const { text } = next.files[event.file];
      next.focus = event.file;
      update(event.file, {
        text: text.slice(0, event.from) + event.text + text.slice(event.to),
        cursor: event.from + event.text.length,
        selection: null,
        diagnostics: next.files[event.file].diagnostics.map((d) => shift(d, event)),
      });
      break;
    }
    case "diagnostics":
      update(event.file, { diagnostics: event.items });
      break;
    case "completions":
      next.popup = { ...event, kind: "completions" };
      break;
    case "info":
      next.popup = { ...event, kind: "info" };
      break;
    case "close":
      next.popup = null;
      break;
    case "browser":
      next.focus = null;
      next.browser = {
        visible: true,
        input: event.input ?? next.browser.input,
        message: event.message ?? next.browser.message,
        pressed: event.pressed ?? next.browser.pressed,
      };
      break;
  }
  return next;
}

/** Keeps an error on the same code while text is typed around or inside it. */
function shift(d: Diagnostic, edit: { from: number; to: number; text: string }): Diagnostic {
  const delta = edit.text.length - (edit.to - edit.from);
  if (edit.to <= d.start) return { ...d, start: d.start + delta };
  if (edit.from >= d.start + d.length) return d;
  return { ...d, length: Math.max(1, d.length + delta) };
}

const finalState = () => events.reduce(apply, initialState());

/** Each editor is as tall as its file gets, so nothing jumps while it grows. */
const lines = (() => {
  const end = finalState();
  return {
    backend: end.files.backend.text.split("\n").length,
    frontend: end.files.frontend.text.split("\n").length,
  };
})();

type Action = { type: "next" } | { type: "reset" } | { type: "finish" };
function reducer(state: State, action: Action): State {
  if (action.type === "reset") return initialState();
  if (action.type === "finish") return finalState();
  const event = events[state.step];
  return event ? apply(state, event) : state;
}

export default function TypeSafetyDemo() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const figure = useRef<HTMLElement>(null);

  // Autoplay while on screen; with reduced motion, show the end and wait for Play.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) dispatch({ type: "finish" });
    else setPlaying(true);
    const element = figure.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.3,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const event = events[state.step];
    if (!event) {
      const restart = setTimeout(() => dispatch({ type: "reset" }), 2500);
      return () => clearTimeout(restart);
    }
    const timer = setTimeout(() => dispatch({ type: "next" }), event.d);
    return () => clearTimeout(timer);
  }, [playing, visible, state.step]);

  const toggle = () => {
    if (!playing && state.step >= events.length) dispatch({ type: "reset" });
    setPlaying((p) => !p);
  };

  return (
    <figure className={styles.demo} ref={figure}>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.editors}>
          {(["backend", "frontend"] as const).map((name) => (
            <Editor
              key={name}
              name={fileNames[name]}
              lines={lines[name]}
              file={state.files[name]}
              focused={state.focus === name}
              popup={state.popup?.file === name ? state.popup : null}
            />
          ))}
        </div>
        <Browser {...state.browser} />
      </div>
      <figcaption className={styles.caption}>
        <span>
          The server adds a required <code>name</code> query parameter. The client's call
          doesn't send it, so the editor marks it, and suggests the fix. Recorded from the
          TypeScript language service.
        </span>
        <button type="button" className={styles.control} onClick={toggle}>
          {playing ? "Pause" : state.step >= events.length ? "Replay" : "Play"}
        </button>
      </figcaption>
    </figure>
  );
}

function Editor(props: {
  name: string;
  lines: number;
  file: FileState;
  focused: boolean;
  popup: Popup | null;
}) {
  const { text, diagnostics } = props.file;
  const errors = diagnostics.length;
  return (
    <section className={styles.editor} data-focused={props.focused || undefined}>
      <div className={styles.tabs}>
        <span className={styles.tab}>
          <span className={styles.tsIcon}>TS</span>
          {props.name.split("/").pop()}
          {errors > 0 && <span className={styles.errorCount}>{errors}</span>}
        </span>
        <span className={styles.path}>{props.name}</span>
      </div>
      <Highlight code={text} language="tsx" theme={themes.vsDark}>
        {({ tokens, getTokenProps }) => (
          <div className={styles.code} style={{ "--lines": props.lines } as CSSProperties}>
            {tokens.map((line, index) => (
              <Line
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                key={index}
                number={index + 1}
                tokens={line}
                start={lineStart(text, index)}
                file={props.file}
                showCursor={props.focused}
                getTokenProps={getTokenProps}
              />
            ))}
            {props.popup && <PopupView popup={props.popup} text={text} />}
          </div>
        )}
      </Highlight>
    </section>
  );
}

function lineStart(text: string, line: number) {
  let offset = 0;
  for (let i = 0; i < line; i++) offset = text.indexOf("\n", offset) + 1;
  return offset;
}

function position(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, col: offset - (before.lastIndexOf("\n") + 1) };
}

/** One line, cut wherever an error, the selection or the cursor starts or ends. */
function Line(props: {
  number: number;
  tokens: Token[];
  start: number;
  file: FileState;
  showCursor: boolean;
  getTokenProps: (input: { token: Token }) => { className: string; style?: object };
}) {
  const { diagnostics, selection, cursor } = props.file;
  const length = props.tokens.reduce((sum, t) => sum + t.content.length, 0);
  const end = props.start + length;
  const cuts = new Set<number>([props.start, end]);
  for (const d of diagnostics) cuts.add(d.start).add(d.start + d.length);
  if (selection) cuts.add(selection[0]).add(selection[1]);
  cuts.add(cursor);

  const pieces: ReactNode[] = [];
  let offset = props.start;
  const caret = (key: string) => <span key={key} className={styles.cursor} />;
  for (const [i, token] of props.tokens.entries()) {
    const tokenEnd = offset + token.content.length;
    const inner = [...cuts].filter((c) => c > offset && c < tokenEnd).sort((a, b) => a - b);
    let from = offset;
    for (const to of [...inner, tokenEnd]) {
      if (props.showCursor && cursor === from && from < end) pieces.push(caret(`c${from}`));
      if (to > from) {
        const { className, style } = props.getTokenProps({ token });
        const squiggle = diagnostics.some((d) => from < d.start + d.length && to > d.start);
        const selected = selection && from >= selection[0] && to <= selection[1];
        pieces.push(
          <span
            key={`${i}-${from}`}
            className={[
              className,
              squiggle ? styles.squiggle : "",
              selected ? styles.selected : "",
            ].join(" ")}
            style={style}
          >
            {token.content.slice(from - offset, to - offset)}
          </span>,
        );
      }
      from = to;
    }
    offset = tokenEnd;
  }
  if (props.showCursor && cursor === end) pieces.push(caret("end"));
  // An error at the end of a line (a missing `)`) still needs something to underline.
  const trailing = diagnostics.some((d) => d.start === end && d.start + d.length > end);
  return (
    <div className={styles.line}>
      <span className={styles.number}>{props.number}</span>
      <span className={styles.content}>
        {pieces}
        {trailing && <span className={styles.squiggle}> </span>}
      </span>
    </div>
  );
}

const kindLetter: Record<string, string> = {
  method: "m",
  function: "f",
  property: "p",
  const: "c",
  let: "v",
  var: "v",
  alias: "T",
  type: "T",
  interface: "I",
  class: "C",
  module: "M",
};

function PopupView({ popup, text }: { popup: Popup; text: string }) {
  const { line, col } = position(text, popup.pos);
  const place = { "--line": line, "--col": col } as CSSProperties;
  if (popup.kind === "completions")
    return (
      <div className={styles.suggest} style={place}>
        <ul>
          {popup.items.map((item, i) => (
            <li key={item.name} data-selected={i === popup.selected || undefined}>
              <span className={styles.kind} data-kind={item.kind}>
                {kindLetter[item.kind] ?? "·"}
              </span>
              {item.name}
            </li>
          ))}
        </ul>
        {popup.detail && <div className={styles.detail}>{popup.detail}</div>}
      </div>
    );
  return (
    <div className={styles.info} data-error={popup.error || undefined} style={place}>
      {popup.text}
    </div>
  );
}

function Browser(props: State["browser"]) {
  return (
    <div className={styles.browser} data-visible={props.visible || undefined}>
      <div className={styles.chrome}>
        <span className={styles.dots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.address}>localhost:5173</span>
      </div>
      <div className={styles.page}>
        <p className={styles.message}>{props.message || " "}</p>
        <div className={styles.form}>
          <span className={styles.input}>
            {props.input || <span className={styles.placeholder}>Your name</span>}
          </span>
          <span className={styles.button} data-pressed={props.pressed || undefined}>
            Welcome
          </span>
        </div>
      </div>
    </div>
  );
}
