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

// Utility types
type ArrayKey = number;
type Primitive = null | undefined | string | number | boolean | symbol | bigint;
/** Cons<'a', ['b', 'c']> => ['a', 'b', 'c']*/
type Cons<H, T extends readonly any[]> = ((h: H, ...t: T) => void) extends (
  ...r: infer R
) => void
  ? R
  : never;
/** TupleKeys<['a', 'b']> => 0 | 1 */
type TupleKeys<T extends any[]> = Exclude<keyof T, keyof any[]>;
/** IsTuple<[number, number]> => true, IsTuple<number[]> = false */
type IsTuple<T extends any[]> = number extends T["length"] ? false : true;
/** PathImpl<'foo', { bar: ['a'] }> => ["foo"] | ["foo", "bar"] | ["foo", "bar", "0"] */
type PathImpl<K extends string | number, V> = V extends Primitive
  ? [K]
  : [K] | Cons<K, Path<V>>;
/** Path<{ foor: { bar: ['a', 'b'] }}> => ["foo"] | ["foo", "bar"] | ["foo", "bar", "0"] | ["foo", "bar", "1"] */
type Path<T> = T extends (infer V)[]
  ? IsTuple<T> extends true
    ? {
        [K in TupleKeys<T>]-?: PathImpl<K & string, T[K]>;
      }[TupleKeys<T>]
    : PathImpl<ArrayKey, V>
  : {
      [K in keyof T]-?: PathImpl<K & string, T[K]>;
    }[keyof T];

export type ImprovedZodIssue<TRequestBody extends Record<string, unknown>> = ZodIssue & {
  path: Path<TRequestBody>;
};

// Factory methods
export const success = <Others>(others: Others) => ({
  result: "success" as const,
  statusCode: 200 as const,
  ...others,
});
export const validationError = <Others extends { message: string }>(others: Others) =>
  apiResponse("validation-error", 422, others);
export const zodValidationError = <TRequestBody extends Record<string, unknown>>(
  issues: ImprovedZodIssue<TRequestBody>[],
): ZodValidationError<TRequestBody> =>
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
export type ZodValidationError<TRequestBody extends Record<string, unknown>> =
  ValidationError<{
    message: string;
    issues: ImprovedZodIssue<TRequestBody>[];
  }>;
