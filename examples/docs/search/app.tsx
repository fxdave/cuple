import { Boundary, CupleProvider, useGetWrapped } from "@cuple/react";
import { useState } from "react";
import { client, store } from "./client";

// #region search
/** Typing doesn't wait for the server; the results follow once it stops. */
export function App() {
  const [q, setQ] = useState("");
  return (
    <CupleProvider store={store}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <Boundary fallback={<p>Searching…</p>}>{q && <Results q={q} />}</Boundary>
    </CupleProvider>
  );
}

function Results({ q }: { q: string }) {
  const found = useGetWrapped(
    client.searchProducts,
    { query: { q } },
    // One request once typing pauses; nothing kept for searches nobody shows.
    { config: { loading: { debounceMs: 300 }, cache: { enabled: false } } },
  );
  // isPending: what's shown is for an earlier q, until the new results land.
  return (
    <ul className={found.isPending ? "stale" : undefined}>
      {found.data.products.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
// #endregion
