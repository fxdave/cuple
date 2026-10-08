import type * as z from "zod";

export type ApiResponse<Result extends string, StatusCode extends number, Others> = {
  result: Result;
  statusCode: StatusCode;
} & Others;

/** Use this type for extends */
export type AbstractApiresponse = ApiResponse<string, number, Record<string, unknown>>;

export const apiResponse = <
  Result extends string,
  StatusCode extends number,
  Others extends { message: string },
>(
  result: Result,
  statusCode: StatusCode,
  others: Others,
): ApiResponse<Result, StatusCode, Others> => ({
  result,
  statusCode,
  ...others,
});

// Factory methods
export const success = <Others>(others: Others) => ({
  result: "success" as const,
  statusCode: 200 as const,
  ...others,
});
/** The part of a request a schema validates. */
export type InputPart = "body" | "query" | "params" | "headers";

/**
 * A request part failed validation: `invalid-body`, `invalid-query`,
 * `invalid-params` or `invalid-headers`. Schemas return it on their own; return
 * it from a handler for a rule a schema can't check (an email already in use),
 * so the client handles both the same way.
 */
export const invalidInput = <TPart extends InputPart>(
  part: TPart,
  issues: (Pick<z.core.$ZodIssue, "code" | "message"> & { path: PropertyKey[] })[],
): InvalidInput<TPart> =>
  apiResponse(`invalid-${part}`, 422, {
    message: "We found some incorrect field(s) during validating the form.",
    issues: issues as InvalidInput<TPart>["issues"],
  });

export const unexpectedError = () =>
  apiResponse("unexpected-error", 500, {
    message: "Something went wrong. Please try again later.",
  });

/** What a status factory takes: a `result` and a `message` to override the defaults, and any extra fields. */
export type StatusResponseOptions<Result extends string> = {
  result?: Result;
  message?: string;
} & Record<string, unknown>;

/** What a status factory returns: the extra fields stay, `message` is always there. */
export type StatusResponse<
  Result extends string,
  StatusCode extends number,
  Others,
> = ApiResponse<
  Result,
  StatusCode,
  Omit<Others, "result" | "message"> & { message: string }
>;

const statusFactory =
  <DefaultResult extends string, StatusCode extends number>(
    defaultResult: DefaultResult,
    statusCode: StatusCode,
    defaultMessage: string,
  ) =>
  <
    Result extends string = DefaultResult,
    Others extends StatusResponseOptions<Result> = {},
  >(
    options?: Others & StatusResponseOptions<Result>,
  ): StatusResponse<Result, StatusCode, Others> =>
    ({
      ...options,
      result: options?.result ?? defaultResult,
      statusCode,
      message: options?.message ?? defaultMessage,
    }) as StatusResponse<Result, StatusCode, Others>;

/**
 * 404. The result is `not-found` unless you name it: when a route can miss
 * more than one thing, name each (`post-not-found`, `author-not-found`) so the
 * client can tell them apart.
 */
export const notFound = statusFactory("not-found", 404, "Not found.");

/** 401: the request has no valid credentials. The result is `unauthorized` unless you name it. */
export const unauthorized = statusFactory("unauthorized", 401, "Please sign in.");

/** 403: the user is known but not allowed. The result is `forbidden` unless you name it. */
export const forbidden = statusFactory(
  "forbidden",
  403,
  "You don't have permission to do this.",
);

/** 409: the request clashes with the current state. The result is `conflict` unless you name it (`email-taken`). */
export const conflict = statusFactory(
  "conflict",
  409,
  "This conflicts with the current state.",
);

// Response types
export type Success<T> = ApiResponse<"success", 200, T>;
export type UnexpectedError = ApiResponse<"unexpected-error", 500, { message: string }>;
export type InvalidInput<TPart extends InputPart> = ApiResponse<
  `invalid-${TPart}`,
  422,
  {
    message: string;
    issues: {
      code: z.core.$ZodIssue["code"];
      message: z.core.$ZodIssue["message"];
      path: (string | number)[];
    }[];
  }
>;
