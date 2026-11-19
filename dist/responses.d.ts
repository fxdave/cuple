import type * as z from "zod";
export type ApiResponse<Result extends string, StatusCode extends number, Others> = {
    result: Result;
    statusCode: StatusCode;
} & Others;
/** Use this type for extends */
export type AbstractApiresponse = ApiResponse<string, number, Record<string, unknown>>;
export declare const apiResponse: <Result extends string, StatusCode extends number, Others extends {
    message: string;
}>(result: Result, statusCode: StatusCode, others: Others) => ApiResponse<Result, StatusCode, Others>;
export declare const success: <Others>(others: Others) => {
    result: "success";
    statusCode: 200;
} & Others;
/** The part of a request a schema validates. */
export type InputPart = "body" | "query" | "params" | "headers";
/**
 * A request part failed validation: `invalid-body`, `invalid-query`,
 * `invalid-params` or `invalid-headers`. Schemas return it on their own; return
 * it from a handler for a rule a schema can't check (an email already in use),
 * so the client handles both the same way.
 */
export declare const invalidInput: <TPart extends InputPart, const TIssues extends readonly (Pick<z.core.$ZodIssue, "code" | "message"> & {
    path: readonly PropertyKey[];
})[]>(part: TPart, issues: TIssues) => InvalidInput<TPart, JsonPath<TIssues[number]["path"]>>;
type JsonPath<TPath> = {
    -readonly [K in keyof TPath]: Exclude<TPath[K], symbol>;
};
export declare const unexpectedError: () => ApiResponse<"unexpected-error", 500, {
    message: string;
}>;
/** What a status factory takes: a `result` and a `message` to override the defaults, and any extra fields. */
export type StatusResponseOptions<Result extends string> = {
    result?: Result;
    message?: string;
} & Record<string, unknown>;
/** What a status factory returns: the extra fields stay, `message` is always there. */
export type StatusResponse<Result extends string, StatusCode extends number, Others> = ApiResponse<Result, StatusCode, Omit<Others, "result" | "message"> & {
    message: string;
}>;
/**
 * 404. The result is `not-found` unless you name it: when a route can miss
 * more than one thing, name each (`post-not-found`, `author-not-found`) so the
 * client can tell them apart.
 */
export declare const notFound: <Result extends string = "not-found", Others extends StatusResponseOptions<Result> = {}>(options?: (Others & {
    result?: Result | undefined;
    message?: string;
} & Record<string, unknown>) | undefined) => StatusResponse<Result, 404, Others>;
/** 401: the request has no valid credentials. The result is `unauthorized` unless you name it. */
export declare const unauthorized: <Result extends string = "unauthorized", Others extends StatusResponseOptions<Result> = {}>(options?: (Others & {
    result?: Result | undefined;
    message?: string;
} & Record<string, unknown>) | undefined) => StatusResponse<Result, 401, Others>;
/** 403: the user is known but not allowed. The result is `forbidden` unless you name it. */
export declare const forbidden: <Result extends string = "forbidden", Others extends StatusResponseOptions<Result> = {}>(options?: (Others & {
    result?: Result | undefined;
    message?: string;
} & Record<string, unknown>) | undefined) => StatusResponse<Result, 403, Others>;
/** 409: the request clashes with the current state. The result is `conflict` unless you name it (`email-taken`). */
export declare const conflict: <Result extends string = "conflict", Others extends StatusResponseOptions<Result> = {}>(options?: (Others & {
    result?: Result | undefined;
    message?: string;
} & Record<string, unknown>) | undefined) => StatusResponse<Result, 409, Others>;
export type Success<T> = ApiResponse<"success", 200, T>;
export type UnexpectedError = ApiResponse<"unexpected-error", 500, {
    message: string;
}>;
export type InvalidInput<TPart extends InputPart, TPath extends (string | number)[] = (string | number)[]> = ApiResponse<`invalid-${TPart}`, 422, {
    message: string;
    issues: {
        code: z.core.$ZodIssue["code"];
        message: z.core.$ZodIssue["message"];
        path: TPath;
    }[];
}>;
type Leaf = string | number | boolean | bigint | symbol | null | undefined | Date;
/** The paths into a value of type `T`: `InputPath<{ a: { b: string[] } }>` is `[] | ["a"] | ["a", "b"] | ["a", "b", number]`. */
export type InputPath<T> = [] | FieldPath<T, []>;
type FieldPath<T, TDepth extends unknown[]> = 0 extends 1 & T ? (string | number)[] : TDepth["length"] extends 10 ? (string | number)[] : T extends Leaf ? never : T extends readonly (infer TItem)[] ? [number] | [number, ...FieldPath<TItem, [...TDepth, 0]>] : {
    [K in keyof T & string]-?: [K] | [K, ...FieldPath<T[K], [...TDepth, 0]>];
}[keyof T & string];
export {};
