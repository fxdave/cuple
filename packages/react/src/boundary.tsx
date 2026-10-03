import {
  Component,
  type ReactNode,
  Suspense,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { ConfigContext, type CupleConfig, mergeConfig } from "./config";
import { type CupleError, toCupleError } from "./errors";
import { missingNotify, useCupleContext } from "./provider";

/**
 * Loading and error UI for everything inside it: a `<Suspense>` and an error
 * boundary in one.
 *
 * ```tsx
 * <Boundary fallback={<Spinner />} error={(error, retry) => <Failed onRetry={retry} />}>
 *   <Orders />
 * </Boundary>
 * ```
 *
 * - Without `fallback`, loading goes to the boundary above.
 * - Without `error`, errors go to the boundary above.
 * - `retry` drops what failed and renders again, which fetches it fresh.
 *
 * Place boundaries where the layout wants loading and error UI: a failing
 * widget should not take the page with it.
 */
export function Boundary(props: {
  fallback?: ReactNode;
  /**
   * What to show instead of the children when something inside fails. It
   * gets a {@link CupleError}: `error.message` is always readable (the
   * server's message, or `config.errors.fallbackMessage`). Or `"notify"`: pass it to
   * `config.errors.notify`, and show nothing in
   * this region while the rest of the page stays.
   */
  error?: ((error: CupleError, retry: () => void) => ReactNode) | "notify";
  /**
   * Settings for everything inside, over the provider's (or an outer
   * Boundary's), one setting at a time. Requests inside can still override them.
   */
  config?: CupleConfig;
  children?: ReactNode;
}): ReactNode {
  const { store } = useCupleContext();
  const parent = useContext(ConfigContext);
  const config = useMemo(() => mergeConfig(parent, props.config), [parent, props.config]);
  const { notify, fallbackMessage } = config.errors;
  const suspended =
    props.fallback === undefined ? (
      props.children
    ) : (
      <Suspense fallback={props.fallback}>{props.children}</Suspense>
    );
  const content =
    props.config === undefined ? (
      suspended
    ) : (
      <ConfigContext.Provider value={config}>{suspended}</ConfigContext.Provider>
    );
  if (!props.error) return content;
  const show = props.error;
  if (show === "notify") {
    return (
      <Catch
        render={(error) => {
          // Nothing to notify with: fail loudly at the boundary above instead.
          if (!notify) throw missingNotify(error);
          return null;
        }}
        onCaught={(error) => notify?.(toCupleError(error, fallbackMessage))}
        onRetry={() => store.dropFailed()}
      >
        {content}
      </Catch>
    );
  }
  return (
    <Catch
      render={(error, retry) => show(toCupleError(error, fallbackMessage), retry)}
      onRetry={() => store.dropFailed()}
    >
      {content}
    </Catch>
  );
}

class Catch extends Component<
  {
    render: (error: unknown, retry: () => void) => ReactNode;
    /** Called once per caught error, after it was caught. */
    onCaught?: (error: unknown) => void;
    onRetry: () => void;
    children: ReactNode;
  },
  { caught: false } | { caught: true; error: unknown }
> {
  state = { caught: false } as { caught: false } | { caught: true; error: unknown };

  static getDerivedStateFromError(error: unknown) {
    return { caught: true, error };
  }

  componentDidCatch(error: unknown) {
    this.props.onCaught?.(error);
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ caught: false });
  };

  render() {
    return this.state.caught
      ? this.props.render(this.state.error, this.retry)
      : this.props.children;
  }
}

/**
 * True while anything someone waits for is loading or running: a read, a
 * refresh, an action. For a thin global progress bar. Polls and preloads don't
 * count.
 *
 * `{ blocking: true }`: only what asked to block — actions and refreshes with
 * `blocking: true`, and refetches of reads with `blocking: true`. For a
 * full-page overlay, shown for the few steps the user must wait for.
 */
export function useIsFetching(options?: { blocking?: boolean }): boolean {
  const { store } = useCupleContext();
  const read = options?.blocking ? () => store.isBlocking() : () => store.isBusy();
  return useSyncExternalStore(
    (listener) => store.subscribeActivity(listener),
    read,
    read,
  );
}
