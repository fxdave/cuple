import { ZodIssue } from "zod";

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
export const validationError = <Others extends { message: string }>(others: Others) =>
  apiResponse("validation-error", 422, others);
export const zodValidationError = (issues: ZodIssue[]): ZodValidationError =>
  validationError({
    message: "We found some incorrect field(s) during validating the form.",
    issues,
  });

export const unexpectedError = () =>
  apiResponse("unexpected-error", 500, {
    message: "Something went wrong. Please try again later.",
  });
// Response types
export type Success<T> = ApiResponse<"success", 200, T>;
export type ValidationError<T> = ApiResponse<"validation-error", 422, T>;
export type UnexpectedError = ApiResponse<"unexpected-error", 500, { message: string }>;
export type ZodValidationError = ValidationError<{
  message: string;
  issues: {
    code: ZodIssue["code"];
    message: ZodIssue["message"];
    path: ZodIssue["path"];
  }[];
}>;
