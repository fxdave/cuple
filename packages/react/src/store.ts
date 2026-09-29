import {
  type ClientEndpointRef,
  CupleTransportError,
  CupleUnexpectedResponseError,
  cupleEndpointKey,
  cupleRequestKey,
  fetchCuple,
  transportErrorResult,
} from "@cuple/client";
import { isCombined } from "./combine";
import { defaultConfig, type ResolvedConfig } from "./config";
import { share, stableStringify } from "./share";
import type {
  CombineContext,
  Readable,
  ReadableArgs,
  ReadRest,
  ResolveOptions,
} from "./types";

/**
 * The cache. Create one per app, pass it to `<CupleProvider store={...}>`, and
 * use it directly from plain code — an SSE handler, a router loader, sign-out.
 *
 * Cached data changes only when an action that names it finishes,
 * `refresh()` or `refreshKeys()` is called, a poll fires, a component starts
 * reading data its config calls stale (`cache.refreshOnRead`), or an entry
 * nobody reads expires. Nothing refetches on focus or on a timer you didn't
 * ask for.
 */
export type CupleStore = {
  /**
   * Refetches every cached call of the given endpoints and combined reads, plus every
   * combined read that fetched one of them through `get`.
   *
   * Calls something is reading now are refetched, and keep their old data on
   * screen until the new data arrives. Calls nobody reads are dropped, so they
   * are fetched fresh when next read — a deleted item nobody shows never 404s.
   *
   * Resolves when the refetches have landed. Never rejects: a failure goes to
   * whoever reads the data.
   *
   * `{ blocking: true }` makes it count for `useIsFetching({ blocking: true })`,
   * e.g. a full-page overlay, until it lands.
   */
  refresh(targets: readonly Readable[], options?: { blocking?: boolean }): Promise<void>;
  /**
   * Starts a fetch before anything renders it — on hover, on click, in a
   * router loader. Don't return it from a router loader: the router would wait
   * for it and handle its errors, instead of `<Boundary>`.
   *
   * Resolves when it has landed. Never rejects, and a failure is not kept:
   * nobody was waiting for it, so the next read fetches again.
   */
  preload<R extends Readable>(readable: R, ...rest: ReadRest<R, never>): Promise<void>;
  /** Drops everything. Readers suspend and fetch again. For sign-out and tests. */
  clear(): void;
  /**
   * Checks every cached call's key again: whatever a `with({ key })` getter
   * returns may have changed (the signed-in user, a tenant, a locale).
   *
   * - Key unchanged: stays as it is. No request, no re-render.
   * - Key changed: its readers read again under the new key — cached data for
   *   it shows at once, anything else loads. The old key's data is dropped, or
   *   kept for `cache.keep` with `cache.onKeyChange: "keep"`.
   * - Combined reads built from a changed call run again; streams reconnect.
   *
   * Nothing is ever refetched under a key that is no longer current, so data
   * of one key can't land under another. Wrap in `startTransition` to keep the
   * current screen until the new data is ready.
   */
  refreshKeys(): void;
};

/** Makes the cache. One per app; one per test. Configure it with `<CupleProvider config>`. */
export function createCupleStore(): CupleStore {
  return new Store();
}

/**
 * How a reader should apply a change. Most are not urgent — new data replacing
 * old — and go through a transition, so a refresh never swaps visible content
 * for a fallback. Urgent ones must leave the screen at once.
 */
type Change = { urgent: boolean };
/**
 * Whether anyone is waiting for a fetch. Background ones (polls, preloads)
 * don't make `useIsFetching` true: a global progress bar that blinks on every
 * hover and every poll interval is noise.
 */
type Priority = "foreground" | "background";
type Listener = (change: Change) => void;

type Entry = {
  key: string;
  readable: Readable;
  args: unknown;
  /** What refresh matches on: the endpoint for endpoint calls, the combined read for combined-read calls. */
  target: string;
  hasValue: boolean;
  value: unknown;
  hasError: boolean;
  error: unknown;
  /** Settles with the first load; what a suspended reader waits on. */
  first: Promise<unknown>;
  settleFirst: { resolve(value: unknown): void; reject(error: unknown): void } | null;
  inflight: Promise<void> | null;
  /**
   * Fetch again once the request in flight lands: it started before whatever
   * asked now. `"foreground"` when someone is waiting for the result.
   */
  queued: false | Priority;
  /** What this combined read fetched through `get`, on its last run. */
  deps: Set<string>;
  /** Bumped whenever what readers see changes. */
  version: number;
  /** A component or combined read has read it; a preload alone doesn't count. */
  observed: boolean;
  /** When its data last landed, for `cache.freshFor`. 0 until then. */
  fetchedAt: number;
  /** Keys of the calls this combined read fetched through `get`, on its last run. */
  childKeys: Set<string>;
  /** The longest `cache.keep` among its readers since it was last unread. */
  keep: number;
  /** Some component has subscribed to it before. */
  readBefore: boolean;
  /** A read of it threw, so a boundary's retry should drop it. */
  threw: boolean;
  gcTimer?: ReturnType<typeof setTimeout>;
};

/** @internal The store's API for the hooks. Not part of the public surface. */
export class Store implements CupleStore {
  private entries = new Map<string, Entry>();
  /** Loose keys of cached calls, per target, for the near-miss warning. */
  private looseKeys = new Map<string, Map<string, Entry>>();
  private listeners = new Map<string, Set<Listener>>();
  private pollers = new Map<string, Map<symbol, number>>();
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private busyCount = 0;
  /** Blocking actions and refreshes in progress. */
  private blockingCount = 0;
  /** Calls read with `{ blocking: true }`, and how many readers ask for it. */
  private blockingReaders = new Map<string, number>();
  private activityListeners = new Set<() => void>();
  private activity = { busy: false, blocking: false };

  private keyListeners = new Set<() => void>();
  private onOnline: (() => void) | null = null;
  /** The provider's config: for plain code (`preload`, `refreshKeys`) and data read outside components. */
  private defaults: ResolvedConfig = defaultConfig;

  setDefaults(config: ResolvedConfig) {
    this.defaults = config;
  }

  // Public API

  refresh(targets: readonly Readable[], options?: { blocking?: boolean }): Promise<void> {
    if (options?.blocking) return this.block(() => this.refresh(targets));
    const matched = this.match(targets.map(toTarget));
    // Endpoints first, so combined reads re-running below reuse their fresh requests.
    const ordered = [...matched].sort(
      (a, b) => Number(isCombined(a.readable)) - Number(isCombined(b.readable)),
    );
    const landed: Promise<void>[] = [];
    for (const entry of ordered) {
      if (this.isRead(entry) || entry.inflight)
        landed.push(this.fetchEntry(entry, "foreground"));
      else this.evict(entry);
    }
    return Promise.all(landed).then(() => undefined);
  }

  async preload<R extends Readable>(readable: R, ...rest: ReadRest<R, never>) {
    const entry = this.ensure(readable, rest[0], "background");
    if (entry.inflight) await entry.inflight;
    if (!entry.observed && !this.isRead(entry) && isFailure(entry)) this.evict(entry);
  }

  clear() {
    for (const entry of this.entries.values()) clearTimeout(entry.gcTimer);
    this.entries.clear();
    this.looseKeys.clear();
    // Urgent: what's on screen may belong to the previous account. As a
    // transition, React would keep showing it until the refetch lands.
    for (const key of [...this.listeners.keys()]) this.notify(key, { urgent: true });
  }

  refreshKeys() {
    const changed = new Set<string>();
    for (const entry of this.entries.values()) {
      if (!isCombined(entry.readable) && keyOf(entry.readable, entry.args) !== entry.key)
        changed.add(entry.key);
    }
    // A combined read's own key is only its args; what it's made of may have moved.
    const rerun = new Set<Entry>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of this.entries.values()) {
        if (rerun.has(entry) || !isCombined(entry.readable)) continue;
        if ([...entry.childKeys].some((key) => changed.has(key))) {
          rerun.add(entry);
          changed.add(entry.key);
          grew = true;
        }
      }
    }
    const drop = this.defaults.cache.onKeyChange === "drop";
    for (const key of changed) {
      const entry = this.entries.get(key);
      if (entry && (drop || rerun.has(entry))) this.evict(entry);
      // Urgent: the old key's data may belong to someone else.
      this.notify(key, { urgent: true });
    }
    for (const listener of [...this.keyListeners]) listener();
  }

  // For the hooks

  /** The entry for a call, created and fetching if it wasn't cached. */
  ensure(route: Readable, args: unknown, priority: Priority = "foreground"): Entry {
    const readable = toTarget(route);
    const key = keyOf(readable, args);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const entry = this.create(key, readable, args);
    this.warnNearMiss(entry);
    void this.fetchEntry(entry, priority);
    return entry;
  }

  keyOf(readable: Readable, args: unknown) {
    return keyOf(toTarget(readable), args);
  }

  /** Changes whenever what a reader of `key` would see changes; -1 when not cached. */
  versionOf(key: string) {
    return this.entries.get(key)?.version ?? -1;
  }

  /** The cached value, if any, without fetching or throwing. */
  peek(key: string): { value: unknown } | undefined {
    const entry = this.entries.get(key);
    return entry?.hasValue ? { value: entry.value } : undefined;
  }

  /**
   * The value a component renders, or throws: the error, or — while nothing is
   * loaded yet — the promise to suspend on (returned, for `use`).
   */
  read(entry: Entry): { value: unknown } | { pending: Promise<unknown> } {
    entry.observed = true;
    const keepValue = entry.hasValue && entry.error instanceof CupleTransportError;
    if (entry.hasError && !keepValue) {
      entry.threw = true;
      throw entry.error;
    }
    if (entry.hasValue) return { value: entry.value };
    return { pending: entry.first };
  }

  /** A failed read: the entry holds a result the reader didn't ask for. */
  markThrew(entry: Entry) {
    entry.threw = true;
  }

  subscribe(
    key: string,
    listener: Listener,
    options: { every?: number; blocking?: boolean; keep?: number } = {},
  ) {
    const { every, blocking = false, keep = this.defaults.cache.keep } = options;
    if (blocking) this.countBlockingReader(key, +1);
    const set = this.listeners.get(key) ?? new Set();
    const entry = this.entries.get(key);
    if (entry) {
      clearTimeout(entry.gcTimer);
      // A new period of being read starts from this reader's `keep`.
      entry.keep = set.size === 0 ? keep : Math.max(entry.keep, keep);
    }
    set.add(listener);
    this.listeners.set(key, set);
    if (entry) entry.readBefore = true;
    const token = Symbol();
    if (every !== undefined) this.addPoller(key, token, every);
    return () => {
      if (blocking) this.countBlockingReader(key, -1);
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
      if (every !== undefined) this.removePoller(key, token);
      const current = this.entries.get(key);
      if (current && !this.isRead(current)) this.scheduleGc(current);
    };
  }

  /**
   * A reader started reading `key`, whose data was already cached when it
   * rendered: refetch in the background if its `refreshOnRead` says so.
   */
  refreshOnRead(key: string, cache: ResolvedConfig["cache"]) {
    const entry = this.entries.get(key);
    if (!entry?.hasValue || entry.inflight || cache.refreshOnRead === "never") return;
    if (cache.refreshOnRead === "stale" && Date.now() - entry.fetchedAt < cache.freshFor)
      return;
    void this.fetchEntry(entry, "background");
  }

  /** Whether a component has read this call before: coming back to it, not a first load. */
  wasRead(key: string) {
    return this.entries.get(key)?.readBefore ?? false;
  }

  /** Called after `refreshKeys()`: for hooks whose keys aren't cache entries (streams). */
  subscribeKeys(listener: () => void) {
    this.keyListeners.add(listener);
    return () => this.keyListeners.delete(listener);
  }

  /** Drops what failed, so a boundary's retry fetches it again. */
  dropFailed() {
    for (const entry of [...this.entries.values()]) {
      if (entry.threw || (entry.hasError && !entry.hasValue)) this.evict(entry);
    }
  }

  /** Anything someone waits for: reads, actions, refreshes. */
  isBusy() {
    return this.busyCount > 0;
  }

  /** Only what asked to block: blocking actions and refreshes, and refetches of blocking reads. */
  isBlocking() {
    if (this.blockingCount > 0) return true;
    for (const key of this.blockingReaders.keys())
      if (this.entries.get(key)?.inflight) return true;
    return false;
  }

  subscribeActivity(listener: () => void) {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  /** Runs work that counts as busy, and as blocking when asked. */
  async track<T>(work: () => Promise<T>, options?: { blocking?: boolean }): Promise<T> {
    this.setBusy(+1);
    try {
      return options?.blocking ? await this.block(work) : await work();
    } finally {
      this.setBusy(-1);
    }
  }

  // Internals

  private create(key: string, readable: Readable, args: unknown): Entry {
    let settleFirst: Entry["settleFirst"] = null;
    const first = new Promise<unknown>((resolve, reject) => {
      settleFirst = { resolve, reject };
    });
    first.catch(() => {}); // Rejections are delivered by `read`, not as unhandled.
    const entry: Entry = {
      key,
      readable,
      args,
      target: targetOf(readable),
      hasValue: false,
      value: undefined,
      hasError: false,
      error: undefined,
      first,
      settleFirst,
      inflight: null,
      queued: false,
      deps: new Set(),
      version: 0,
      observed: false,
      threw: false,
      fetchedAt: 0,
      childKeys: new Set(),
      keep: this.defaults.cache.keep,
      readBefore: false,
    };
    this.entries.set(key, entry);
    this.scheduleGc(entry);
    return entry;
  }

  /**
   * Fetches an entry. If a request is already in flight, it started before
   * whatever is asking now, so one more fetch is queued after it — never more.
   * Resolves when the entry is up to date.
   */
  private fetchEntry(entry: Entry, priority: Priority): Promise<void> {
    // Its key changed since it was cached (see `refreshKeys`): fetching now
    // would put the new key's data under the old one.
    if (!isCombined(entry.readable) && keyOf(entry.readable, entry.args) !== entry.key)
      return Promise.resolve();
    if (entry.inflight) {
      if (entry.queued !== "foreground") entry.queued = priority;
      return entry.inflight;
    }
    const landed = this.request(entry, priority).then((): Promise<void> | undefined => {
      entry.inflight = null;
      const queued = entry.queued;
      entry.queued = false;
      if (queued && this.entries.get(entry.key) === entry)
        return this.fetchEntry(entry, queued);
      this.emitActivity();
    });
    entry.inflight = landed;
    this.emitActivity();
    return landed;
  }

  private async request(entry: Entry, priority: Priority) {
    const busy = priority === "foreground" ? 1 : 0;
    this.setBusy(+busy);
    try {
      const value = isCombined(entry.readable)
        ? await entry.readable.load(this.contextFor(entry), entry.args)
        : await fetchCuple(entry.readable as ClientEndpointRef, entry.args as never);
      this.land(entry, { value });
    } catch (error) {
      this.land(entry, { error });
    } finally {
      this.setBusy(-busy);
    }
  }

  private land(entry: Entry, outcome: { value: unknown } | { error: unknown }) {
    if (this.entries.get(entry.key) !== entry) return; // cleared or evicted meanwhile
    if ("value" in outcome) {
      entry.value = entry.hasValue ? share(entry.value, outcome.value) : outcome.value;
      entry.hasValue = true;
      entry.hasError = false;
      entry.error = undefined;
      entry.threw = false;
      entry.fetchedAt = Date.now();
      entry.settleFirst?.resolve(entry.value);
    } else {
      entry.hasError = true;
      entry.error = outcome.error;
      if (outcome.error instanceof CupleTransportError) this.retryWhenOnline();
      if (!entry.hasValue) entry.settleFirst?.reject(outcome.error);
    }
    entry.settleFirst = null;
    entry.version++;
    this.notify(entry.key);
  }

  private contextFor(parent: Entry): CombineContext {
    parent.deps.clear();
    parent.childKeys.clear();
    return {
      get: async (readable: Readable, ...rest: unknown[]) => {
        const [args, options] = rest as [unknown, ResolveOptions<Readable> | undefined];
        const child = this.ensure(readable, args, "foreground");
        child.observed = true;
        parent.deps.add(child.target);
        parent.childKeys.add(child.key);
        if (child.inflight) await child.inflight;
        const keepValue = child.hasValue && child.error instanceof CupleTransportError;
        if (child.hasError && !keepValue) {
          if (listsTransportError(options) && child.error instanceof CupleTransportError)
            return transportErrorResult(child.error);
          throw child.error;
        }
        return resolveResult(child, options);
      },
    } as CombineContext;
  }

  /** The entries a refresh of these targets reaches, including dependent combined reads. */
  private match(targets: readonly Readable[]) {
    const reached = new Set(targets.map(targetOf));
    const matched = new Set<Entry>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of this.entries.values()) {
        if (matched.has(entry)) continue;
        if (
          reached.has(entry.target) ||
          [...entry.deps].some((dep) => reached.has(dep))
        ) {
          matched.add(entry);
          if (!reached.has(entry.target)) reached.add(entry.target);
          grew = true;
        }
      }
    }
    return matched;
  }

  /**
   * A miss whose args equal a cached call's once numbers and strings are
   * compared loosely is almost always a bug — a router param read as `"5"`,
   * a component passing `5` — and it silently fetches everything twice.
   */
  private warnNearMiss(entry: Entry) {
    const byLoose = this.looseKeys.get(entry.target) ?? new Map<string, Entry>();
    this.looseKeys.set(entry.target, byLoose);
    const loose = looseKey(entry.args);
    const other = byLoose.get(loose);
    if (other && this.entries.get(other.key) === other) {
      console.warn(
        `@cuple/react: cache miss for ${stableStringify(entry.args)}, but ${stableStringify(other.args)} is cached. ` +
          "They differ only in number vs string, so they are fetched and cached separately.",
      );
    }
    byLoose.set(loose, entry);
  }

  private isRead(entry: Entry) {
    return (this.listeners.get(entry.key)?.size ?? 0) > 0;
  }

  private evict(entry: Entry) {
    clearTimeout(entry.gcTimer);
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    const byLoose = this.looseKeys.get(entry.target);
    const loose = looseKey(entry.args);
    if (byLoose?.get(loose) === entry) byLoose.delete(loose);
  }

  private scheduleGc(entry: Entry) {
    clearTimeout(entry.gcTimer);
    entry.gcTimer = setTimeout(() => {
      if (!this.isRead(entry) && !entry.inflight) this.evict(entry);
      else if (!this.isRead(entry)) this.scheduleGc(entry);
    }, entry.keep);
    (entry.gcTimer as { unref?: () => void }).unref?.();
  }

  private notify(key: string, change: Change = { urgent: false }) {
    for (const listener of [...(this.listeners.get(key) ?? [])]) listener(change);
  }

  private setBusy(delta: number) {
    this.busyCount += delta;
    this.emitActivity();
  }

  private async block<T>(work: () => Promise<T>): Promise<T> {
    this.blockingCount++;
    this.emitActivity();
    try {
      return await work();
    } finally {
      this.blockingCount--;
      this.emitActivity();
    }
  }

  private countBlockingReader(key: string, delta: number) {
    const count = (this.blockingReaders.get(key) ?? 0) + delta;
    if (count > 0) this.blockingReaders.set(key, count);
    else this.blockingReaders.delete(key);
    this.emitActivity();
  }

  /** Tells `useIsFetching` readers, when either answer changed. */
  private emitActivity() {
    const next = { busy: this.isBusy(), blocking: this.isBlocking() };
    if (next.busy === this.activity.busy && next.blocking === this.activity.blocking)
      return;
    this.activity = next;
    for (const listener of [...this.activityListeners]) listener();
  }

  private addPoller(key: string, token: symbol, every: number) {
    const polls = this.pollers.get(key) ?? new Map();
    polls.set(token, every);
    this.pollers.set(key, polls);
    this.restartPoll(key);
  }

  private removePoller(key: string, token: symbol) {
    this.pollers.get(key)?.delete(token);
    this.restartPoll(key);
  }

  /** One timer per entry, at the shortest interval anyone asked for. */
  private restartPoll(key: string) {
    clearInterval(this.pollTimers.get(key));
    this.pollTimers.delete(key);
    const intervals = [...(this.pollers.get(key)?.values() ?? [])];
    if (intervals.length === 0) {
      this.pollers.delete(key);
      return;
    }
    const timer = setInterval(
      () => {
        const entry = this.entries.get(key);
        if (entry && !entry.inflight) void this.fetchEntry(entry, "background");
      },
      Math.min(...intervals),
    );
    (timer as { unref?: () => void }).unref?.();
    this.pollTimers.set(key, timer);
  }

  /**
   * Listens for the browser coming back online only while a network failure is
   * held, so a store — one per test, one per hot reload — leaves no listener.
   */
  private retryWhenOnline() {
    if (this.onOnline || typeof window === "undefined") return;
    this.onOnline = () => {
      window.removeEventListener("online", this.onOnline!);
      this.onOnline = null;
      this.retryTransportFailures();
    };
    window.addEventListener("online", this.onOnline);
  }

  private retryTransportFailures() {
    for (const entry of this.entries.values()) {
      if (entry.error instanceof CupleTransportError && this.isRead(entry))
        void this.fetchEntry(entry, "background");
    }
  }
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * A route stands for its GET endpoint. At runtime a route and an endpoint are
 * the same kind of proxy; an endpoint's last segment is its HTTP method. (So a
 * route itself *named* like a method, `client.get`, needs `.get` written out.)
 */
function toTarget(readable: Readable): Readable {
  if (isCombined(readable)) return readable;
  const { method, segments } = (readable as ClientEndpointRef).clientProps ?? {};
  if (!HTTP_METHODS.has(method)) return (readable as { get: ClientEndpointRef }).get;
  if (method !== "get") {
    const name = [...(segments ?? []), method].join(".");
    throw new Error(
      `@cuple/react: reads are GET only, but ${name} is a ${method.toUpperCase()}: a write, which would run on every render, refresh and poll. ` +
        "For a POST that only reads, wrap it: combine(() => fetchCuple(...).thenUnwrap()).",
    );
  }
  return readable;
}

function targetOf(readable: Readable): string {
  return isCombined(readable)
    ? `combined:${readable.id}`
    : `endpoint:${cupleEndpointKey(readable as ClientEndpointRef)}`;
}

function keyOf(readable: Readable, args: unknown): string {
  if (isCombined(readable)) return `combined:${readable.id}:${stableStringify(args)}`;
  const [endpoint, client, input] = cupleRequestKey(readable as ClientEndpointRef, args);
  return `endpoint:${endpoint}:${stableStringify([client, input])}`;
}

function looseKey(args: unknown) {
  return stableStringify(
    JSON.parse(
      JSON.stringify(args ?? null, (_key, value) =>
        typeof value === "number" ? String(value) : value,
      ),
    ),
  );
}

/** A value nobody should be shown unasked: a failure, or a non-success result. */
function isFailure(entry: Entry) {
  if (entry.hasError) return true;
  if (isCombined(entry.readable)) return false;
  return (entry.value as { result?: unknown } | undefined)?.result !== "success";
}

/** Whether a read listed `"transport-error"`: then a network failure is a value, not an error. */
export function listsTransportError(options?: ResolveOptions<Readable>) {
  const listed = (options?.resolveOn ?? options?.resolveAlso ?? []) as readonly string[];
  return listed.includes("transport-error");
}

/**
 * Applies `resolveOn`/`resolveAlso` to a cached result. Combined values pass
 * through: they are whatever the combined read returned.
 */
export function resolveResult(entry: Entry, options?: ResolveOptions<Readable>) {
  if (isCombined(entry.readable)) return entry.value;
  const value = entry.value as { result?: string };
  const allowed = options?.resolveOn ?? ["success", ...(options?.resolveAlso ?? [])];
  if ((allowed as readonly unknown[]).includes(value?.result)) return value;
  throw new CupleUnexpectedResponseError(value as never);
}

export type { Entry, ReadableArgs };
