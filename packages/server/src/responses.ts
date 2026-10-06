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
