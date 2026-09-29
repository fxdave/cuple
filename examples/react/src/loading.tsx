import { useIsFetching } from "@cuple/react";

/** A thin line at the top while anything syncs in the background. */
export function ProgressBar() {
  const busy = useIsFetching();
  return (
    <div
      className="progress"
      data-active={busy}
      role="status"
      aria-label={busy ? "Syncing" : undefined}
    />
  );
}

// #region page-overlay
/**
 * Covers the page while a blocking step runs: only work that asked for it with
 * `blocking: true`, never ordinary loads.
 */
export function PageOverlay() {
  const blocking = useIsFetching({ blocking: true });
  if (!blocking) return null;
  return (
    <div className="overlay" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      Working…
    </div>
  );
}
// #endregion

/** One line of placeholder text. */
export function Skeleton({ width }: { width: string }) {
  return <span className="skeleton" style={{ width }} />;
}

/** Placeholder rows, shaped like the notes list. */
export function RowsSkeleton({ rows }: { rows: number }) {
  const widths = ["70%", "55%", "80%", "60%", "65%"];
  return (
    <ul aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <li key={i} className="row">
          <Skeleton width={widths[i % widths.length]} />
        </li>
      ))}
    </ul>
  );
}

/** A button that shows its own work: spinner and label, same width. */
export function BusyButton(props: {
  busy: boolean;
  busyLabel: string;
  children: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.busy || props.disabled}
      aria-busy={props.busy}
    >
      {/* Both labels share one grid cell, so the button is always as wide as the wider one. */}
      <span className="labels">
        <span data-visible={!props.busy}>{props.children}</span>
        <span data-visible={props.busy}>
          <span className="spinner" aria-hidden />
          {props.busyLabel}
        </span>
      </span>
    </button>
  );
}
