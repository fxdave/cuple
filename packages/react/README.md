# @cuple/react

React bindings for [Cuple RPC](https://github.com/fxdave/cuple): `fetchCuple` with memory.

- **Reads** cache what `fetchCuple` returns, suspend while loading, and are success-only unless you say otherwise.
- **Writes** are your own async function. You get its state, its errors routed somewhere visible, and a refresh of exactly what it names.
- **No invalidation magic.** Cached data changes only when:
  - an action that names it finishes,
  - `refresh()` is called,
  - a poll fires,
  - or an entry nobody reads expires.

  Nothing refetches on focus, on mount, or on a timer you didn't ask for.

Requires React 19.

## Setup

```tsx
// cuple.ts
import { createClient } from "@cuple/client";
import { createCupleStore } from "@cuple/react";
import type { Routes } from "../server";

export const client = createClient<Routes>({ path: "/rpc" });
export const store = createCupleStore();
```

```tsx
// app.tsx
import { Boundary, CupleProvider } from "@cuple/react";

<CupleProvider
  store={store}
  config={{
    errors: {
      notify: (error) => toast(error.message),
      // An error nobody handled: offline is a toast, anything else goes to the nearest <Boundary>.
      onError: (error) => (error.kind === "transport" ? "notify" : "boundary"),
    },
  }}
>
  <Boundary fallback={<Spinner />} error={(error, retry) => <Failed message={error.message} onRetry={retry} />}>
    <App />
  </Boundary>
</CupleProvider>
```

## Reading

```tsx
const { products } = useGet(client.getProducts); // = client.getProducts.get: a route stands for its GET endpoint
```

- **Reads are GET only.** A read runs on every render, refresh and poll, so a write endpoint (`client.createTodo.post`) is refused, by the types and at runtime. For a POST that only reads (a search), wrap it in `combine` with `fetchCuple` inside.
- **Suspends** until the data is there. Loading and errors show at the nearest `<Boundary>`.
- **Success only.** Any other result throws to the boundary, so the simple case never checks errors.
- **Keep an expected failure as a typed value** with `resolveAlso`:

  ```tsx
  const order = useGet(client.getOrder, { params: { id } }, { resolveAlso: ["not-found-error"] });
  if (order.result === "not-found-error") return <p>This order was deleted.</p>;
  ```

  `resolveOn: [...]` is the complete list instead: success is not implied. These are the same idea as `fetchCuple(...).thenResolveAlso([...])` / `.thenResolveOn([...])`: spelled as an option on a hook, and as a method on a request.
- **Result names** (`"not-found-error"`, `"notFound"`) are whatever your server returns; pick one convention.
- **Shared.** Every reader of the same call shares one request and one cached result.
- **New args suspend again.** Old data belongs to other args. To keep it on screen while the new args load, pass `useDeferredValue(args)`.
- **Search boxes:** `{ config: { loading: { debounceMs: 300 }, cache: { enabled: false } } }` sends one request once typing pauses, keeps the old results on screen while the new ones load, aborts a search the user typed past while it loads, and keeps nothing for searches nobody shows anymore.
- **More than the data:** `useGetWrapped` takes the same arguments and returns `{ data, isPending }`. `isPending`: newer args are waiting for `debounceMs` or loading, so `data` is still the previous args', e.g. to dim search results.
- **Conditional fetching is conditional rendering:** `{id && <Order id={id} />}`. There is no flag to skip a fetch.
- **Polling:** `useGet(client.getStats, undefined, { config: { loading: { everyMs: 30_000 } } })`. It polls only while something reads it. When several readers poll the same data at different intervals, the shortest wins.
- **Coming back to cached data** (another tab, a reopened panel) shows it at once and refreshes it in the background. See Configuration. "Coming back" means some component has read this data before; the first component to read it just loads it, once.

- **A route stands for its GET endpoint:** `useGet(client.getNote, ...)` is `useGet(client.getNote.get, ...)`, the same cached call. It works wherever something is read or refreshed. A route itself named like an HTTP method (`client.get`) needs `.get` written out.
- **Args:** optional when the endpoint takes no input. A middle argument can't be left out, so pass `undefined`: `useGet(client.getStats, undefined, { config })`, `usePages(client.getFeed, undefined, next)`.

### Several fetches, one value: `combine`

```ts
export const loadOrderWithCustomer = combine({
  load: async (ctx, id: number) => {
    const { order } = await ctx.get(client.getOrder, { params: { id } });
    const { customer } = await ctx.get(client.getCustomer, { params: { id: order.customerId } });
    return { order, customer };
  },
});

const { order, customer } = useGet(loadOrderWithCustomer, id);
```

- **A plain async function:** dependent fetches use `await`, parallel ones use `Promise.all`.
- **`ctx.get` reads through the cache,** so it shares requests with every other reader. It's also what lets refreshing `client.getOrder` re-run this combined read.
- **It owns what it fetches:** the calls made through `ctx.get` are kept as long as the combined read is, whatever their own cache settings say. `storeStaleMs: Infinity` on the combined read means its pieces stay too, so the next run never refetches them behind your back.
- **Create combined reads at module level.** A combined read's identity is its cache key.
- **One failed `get` fails the whole read.** If `getOrder` returns a 404, `loadOrderWithCustomer` throws to the `<Boundary>`, like any read. To go on without it, list it: `ctx.get(client.getOrder, args, { resolveAlso: ["not-found-error"] })`.
- **Args must be JSON** (numbers, strings, plain objects and arrays): they are the cache key. A `Date` or a class instance would not match itself later.

### Pages

```tsx
const notes = usePages(client.getNotes, { query: {} }, (last) =>
  last.nextCursor === null ? null : { query: { cursor: last.nextCursor } },
);

notes.pages.flatMap((page) => page.notes);
<button onClick={notes.loadMore} disabled={!notes.hasMore || notes.isPending}>More</button>
```

- Every page is an ordinary cached call.
- A refresh refetches the loaded pages and follows cursors that changed.
- `loadMore` keeps the loaded pages on screen while the next one loads.

## Writing: `useAction`

```tsx
const save = useAction(
  (values: FormValues) =>
    fetchCuple(client.updateOrder.put, { params: { id }, body: values })
      .thenResolveAlso(["validation-error", "transport-error"]),
  { refresh: [client.getOrder, client.getOrders] },
);

<form onSubmit={form.handleSubmit(save.run)}>
  <button disabled={save.isPending} aria-busy={save.isPending}>Save</button>
  {save.value?.result === "success" && <p>Saved</p>}
  {save.value?.result === "validation-error" && <Issues issues={save.value.issues} />}
  {save.value?.result === "transport-error" && <p>You're offline. Try again.</p>}
</form>
```

### Status

| `status`  | Meaning |
| --------- | ------- |
| `idle`    | Nothing has happened yet. |
| `pending` | Running, including the refresh it asked for. The screen keeps the old data until the new data lands. |
| `done`    | Your function finished. `value` is what it returned, including failures you listed with `thenResolveAlso`, so check `value.result`. |
| `failed`  | Your function threw something nobody handled, and `errors.onError` sent it to `"notify"` or `null`. `error` is the `CupleError`. |

### Errors

- **Handled = listed.** Results you list with `thenResolveAlso` (and `"transport-error"`, for no answer at all) are typed values in `value`.
- **Unhandled = everything else** (an unlisted result, an unlisted network failure, a bug), normalized to a `CupleError` (`kind`, an always-readable `message`, `statusCode`, `result`, `cause`). `config.errors.onError`, on the action, a `<Boundary>`, or the provider, decides where it goes (`null`: handled, only the action's `error` holds it):
  - `"boundary"`: the nearest `<Boundary>`. The default.
  - `"notify"`: `config.errors.notify` shows it; the page stays, status `failed`.
  - Or a function choosing per error: `(error) => (error.kind === "transport" ? "notify" : "boundary")`.
- **`message` is always readable:** the server's message, your own error's in development, otherwise `config.errors.fallbackMessage` (`"Something went wrong."`).
- **Reads:** `<Boundary error="notify">` notifies and shows nothing in that region; the rest of the page stays.
- **Errors never end up only in the console.**
- **`run` never rejects.** It resolves with the resulting state, so form libraries don't hang and event handlers don't produce unhandled rejections.

### Refresh

- **Nothing is refreshed unless `refresh` names it.** It refetches every cached call of the listed endpoints and combined reads, and every combined read that fetched them through `get`.
- **Two forms, both explicit:** `refresh: [...]` refreshes every time the function finishes; `refresh: { success: [...] }` only for the listed results. The keys are typed from what the function returns.
- **Keep the invalidation graph in one file,** as plain arrays:

  ```ts
  export const refreshes = {
    permits: [client.getTrackedPermits, client.getProperties], // properties show permit counters
    compliances: [client.compliances.list],
  };

  useAction(untrackPermit, { refresh: refreshes.permits });
  ```

- **Only calls something is reading are refetched.** The rest are dropped and fetched fresh when next read. So an item you delete, and whose pane you close inside the action, never 404s.

### Rules of thumb

- **One action per row:** call `useAction` in the row component, so each row has its own `isPending`.
- **Give the component a `key` when it moves to another item** (`key={order.id}`), or it shows the previous item's result.
- **Steps that must all happen or none belong in one server route.** The client can sequence steps; it can't make them a transaction.

## Streams

```tsx
const feed = useStream(client.activity.get, {}, (event) => {
  store.refresh([client.getNotes]); // someone else changed notes
});
```

- **Events aren't stored.** The callback decides what to keep and what to refresh.
- **The hook owns the connection.** It closes on unmount and reopens when the args change.
- **A rejected connection** (e.g. `401`) throws to the nearest `<Boundary>`.
- **A network failure is kept as `feed.error`,** with `isStreaming: false`. `feed.reconnect()` tries again.

## The store, from plain code

```ts
store.refresh([client.getOrders]); // SSE handler: someone else changed orders
store.preload(loadOrderWithCustomer, 5); // on hover: fetch before the click
store.refreshKeys(); // the key getter's value changed (account switch): re-read what depends on it
store.clear(); // sign-out
```

- **`refresh` resolves when the new data has landed, and never rejects:** a failure goes to whoever reads the data. Data on screen stays until the new data arrives; data nobody reads is dropped and fetched fresh when next read.
- **`refreshKeys`** re-reads only calls whose `with({ key })` changed. The old key's data is dropped, or kept for instant switch-back with `config.cache.keepOnKeyChange: true` (only when one person owns every account: the old data shows again at once). Sign-out still uses `clear()`.
- **`preload` never rejects,** and a failed preload isn't kept: nobody was waiting for it.
- **A read that misses the cache only because `"5"` and `5` differ** logs a warning: the router gave a string, the component a number, and both got fetched.
- **In a router loader, call `preload` without returning it,** so loading and errors stay with `<Boundary>`.

Other exports:

- **`useIsFetching()`:** true while any read, refresh or action runs. For a global progress bar.
- **`<Boundary>` without `fallback`:** loading goes to the boundary above.
- **`<Boundary>` without `error`:** errors go to the boundary above.
- **`retry`** in `<Boundary error={(error, retry) => …}>` drops the data that failed from the cache and renders again, so it's fetched fresh. Other data is untouched.

## Testing

```tsx
import { mockCuple, renderWithCuple } from "@cuple/react/testing";

const mock = mockCuple<typeof routes>({
  getTodos: { get: () => ({ result: "success", statusCode: 200, todos: ["milk"] }) },
});
vi.stubGlobal("fetch", mock.fetch);
await renderWithCuple(<Boundary fallback="loading"><Todos /></Boundary>);
```

- **`renderWithCuple`:** a fresh store, and the awaited `act` React 19 needs for Suspense (plain `render` never leaves the fallback).
- **`mockCuple`:** a fake server typed from your routes. Wrong shapes and unknown endpoints are type errors; a request with no handler fails with the endpoint's name. `mock.calls` lists every request in order: `mock.calls[0].endpoint` is `"getTodos.get"`, `mock.calls[0].input` holds its `params`, `query`, `body` and `headers`.

## Full-page loading

`config: { loading: { blocking: true } }` on an action, a read or a `<Boundary>`, or `store.refresh(targets, { blocking: true })`, and `useIsFetching({ blocking: true })` for the overlay. Only what opted in blocks the page.

## Configuration

One `config` object, grouped into `cache`, `errors` and `loading`, accepted by `<CupleProvider config>`, `<Boundary config>` and each request's `{ config }`. Each setting cascades on its own: request over Boundary over provider over the built-in default.

| Setting | Default |
| ------- | ------- |
| `cache.enabled` | `true`; `false` drops data as soon as nobody reads it |
| `cache.freshMs` | `0`: coming back to cached data refreshes it in the background |
| `cache.storeStaleMs` | 5 minutes of being stale and unread |
| `cache.keepOnKeyChange` | `false` (for `store.refreshKeys()`) |
| `errors.onError` | `"boundary"` |
| `errors.notify` | none |
| `errors.fallbackMessage` | `"Something went wrong."` |
| `loading.blocking` | `false` |
| `loading.everyMs` | none (reads only) |
| `loading.debounceMs` | none (`useGet` only) |

## Why it works this way

- **Most data bugs are timing bugs.** Refetching on focus, on mount or on a timer changes a screen while the user reads it. Here data changes only for a reason written in the code: an action's `refresh`, a poll you set, a call to the store.
- **Loading and errors belong to the layout.** With `isLoading` in every component, a page with five reads pops in five times. Components read data as if it's there; a `<Boundary>` decides what the user sees meanwhile.
- **The call is the cache key.** Hand-written keys drift from the request, and two different requests end up sharing one entry. Here the endpoint, the client's key and the arguments are the key.
- **List what you handle.** `catch (error)` gives you `unknown`. A listed result is in the return type with its real shape, and whatever nobody listed goes to a boundary instead of the console.
- **Writes are your own async function, with an explicit refresh list.** Mutation configs split a sequence into callbacks, and guessed invalidation either misses something or refetches everything. A function reads top to bottom, and a list can be reviewed.
