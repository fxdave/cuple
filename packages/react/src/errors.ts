import { CupleTransportError, CupleUnexpectedResponseError } from "@cuple/client";

/**
 * Any error nobody handled, made readable. `<Boundary error>` and
 * `config.errors.notify` receive this, whatever was thrown.
 *
 * - `"response"`: the server answered with a result nobody listed (a 403, a
 *   500). `message` is the server's, when it sent one.
 * - `"transport"`: no Cuple answer at all — offline, DNS, a proxy's error page.
 * - `"bug"`: your code threw. `message` is the error's own in development, and
 *   the fallback in production, so internals never reach users.
 *
 * Errors you handle never get here: list them (`resolveAlso`, `thenKeep`),
 * and they are typed values instead.
 */
export type CupleError = {
  kind: "response" | "transport" | "bug";
  /** Always readable; `config.errors.fallbackMessage` when there's nothing better. */
  message: string;
  /** The HTTP status, when there was a response. */
  statusCode: number | null;
  /** For `"response"`: the result the server sent, e.g. `"forbidden-error"`. */
  result: string | null;
  /** What was actually thrown, for logging and reporting. */
  cause: unknown;
};

/** Makes any thrown value a {@link CupleError}. */
export function toCupleError(error: unknown, fallback: string): CupleError {
  if (error instanceof CupleUnexpectedResponseError) {
    const message = error.response?.message;
    return {
      kind: "response",
      message: typeof message === "string" && message !== "" ? message : fallback,
      statusCode: error.statusCode,
      result: typeof error.response?.result === "string" ? error.response.result : null,
      cause: error,
    };
  }
  if (error instanceof CupleTransportError) {
    return {
      kind: "transport",
      message: fallback,
      statusCode: error.statusCode,
      result: null,
      cause: error,
    };
  }
  const own = (error as { message?: unknown } | null)?.message;
  return {
    kind: "bug",
    message: isDevelopment() && typeof own === "string" && own !== "" ? own : fallback,
    statusCode: null,
    result: null,
    cause: error,
  };
}

/** Bundlers replace `process.env.NODE_ENV`; without one, assume production and show less. */
function isDevelopment() {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
    ?.NODE_ENV;
  return env !== undefined && env !== "production";
}
