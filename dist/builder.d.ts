import { type Express, type Request, type Response } from "express";
import type z from "zod";
import { type ZodType } from "zod";
import type { RawBodyParser } from "./body-parsers";
import { type InputPart, type InputPath, type InvalidInput, type UnexpectedError } from "./responses";
type ExpressRequest = Request;
type ExpressResponse = Response;
type MiddlewareProps<TData> = {
    data: TData;
    req: ExpressRequest;
    res: ExpressResponse;
};
/**
 * `disconnectSignal` aborts when the client goes away.
 *
 * A generator parked on `yield` is closed by `returnOnDisconnect`, but one
 * parked on an `await` cannot be: the close request is queued behind the
 * pending promise, and a generator waiting on an event that never comes stays
 * waiting, holding its subscription. Pass this signal to whatever is awaited
 * (`events.on`, `fetch`, `addEventListener`) so it is released on disconnect.
 */
type SSEProps<TData> = MiddlewareProps<TData> & {
    disconnectSignal: AbortSignal;
};
type BaseData = object;
type Middleware<TInput, TData, TResult, TDependecyData = any> = (props: MiddlewareProps<TData>) => Promise<TResult & ({
    next: true;
} | {
    next: false;
    statusCode: number;
})>;
/** The last middleware */
type Finalware<TData, TResult> = (props: MiddlewareProps<TData>) => Promise<TResult>;
type UndefinedProperties<T extends object> = {
    [Key in keyof T]-?: undefined extends T[Key] ? Key : never;
}[keyof T];
type NotUndefinedProperties<T extends object> = {
    [Key in keyof T]-?: undefined extends T[Key] ? never : Key;
}[keyof T];
type WithoutUndefinedProperties<T extends object> = Pick<T, NotUndefinedProperties<T>> & {
    [Key in UndefinedProperties<T>]?: never;
};
/** A request's parts, for calling an endpoint in-process. */
export type EndpointInput = Partial<Record<InputPart, unknown>>;
/**
 * What an endpoint answers: `json` from get/post/…, `raw` from getRaw/…,
 * `sse` from getSSE/….
 */
export type EndpointKind = "json" | "raw" | "sse";
export type InvokeOptions = {
    /** The request to inherit from (ip, protocol, …); the input replaces its parts. */
    req?: ExpressRequest;
    /** Defaults to a response that ignores what's set on it. */
    res?: ExpressResponse;
    /** Skip the first `skip` middlewares: `data` is what they produced. */
    skip?: number;
    data?: object;
};
/**
 * Built endpoint with server and client types.
 * Runtime data: the fields starting with `_`.
 * The `t…` fields are typing only, for @cuple/client and others.
 */
export type BuiltEndpoint<TInput extends object, TResponses, TMethod extends HttpVerbs, TMeta, TKind extends EndpointKind = EndpointKind> = {
    tMeta: TMeta;
    tKind: TKind;
    tInput: WithoutUndefinedProperties<{
        body: TInput extends {
            body?: unknown;
        } ? TInput["body"] : undefined;
        query: TInput extends {
            query?: unknown;
        } ? TInput["query"] : undefined;
        params: TInput extends {
            params?: unknown;
        } ? TInput["params"] : undefined;
        headers: TInput extends {
            headers?: unknown;
        } ? TInput["headers"] : undefined;
    }>;
    tOutput: TResponses;
    tMethod: TMethod;
} & {
    _handler: (req: ExpressRequest, res: ExpressResponse) => void;
    _method: TMethod;
    _kind: TKind;
    /** `.meta()`'s object. */
    _meta?: object;
    /** The schemas the chain validates, links included, in order. */
    _inputs: EndpointSchema[];
    /** Whether the body is read by rawBody() rather than as JSON. */
    _rawBody: boolean;
    /** Runs the endpoint without HTTP; only `json` endpoints have it. */
    _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
        statusCode: number;
    } & Record<string, unknown>>;
};
export type EndpointSchema = {
    part: InputPart;
    schema: ZodType;
};
type HttpVerbs = "get" | "post" | "put" | "patch" | "delete";
type ErrorHandler = (data: {
    err: unknown;
    req: ExpressRequest;
    res: ExpressResponse;
}) => UnexpectedError;
type ValidJson = undefined | null | string | number | boolean | ValidJson[] | {
    [K in string]: ValidJson;
};
type ValidJsonObject = {
    [K in string]: ValidJson;
};
type ValidMiddlewareReturnType = (ValidJsonObject & {
    next: false;
    statusCode: number;
}) | {
    next: true;
};
export type SSEOptions = {
    /**
     * Whether to close the handler's generator when the client disconnects.
     * Defaults to `true`.
     *
     * `false` is for a generator that ends on its own — one draining a finite
     * job, say, that should finish its work whether or not anyone is still
     * reading. A generator that loops forever must not opt out: nothing will stop
     * it, and after the client is gone it keeps running at full speed, one
     * runaway loop per disconnected request, for the life of the process.
     *
     * A generator that needs to outlive the disconnect only briefly should check
     * `disconnectSignal.aborted` on each pass and return once it is set. That is
     * also the only way to end one parked on an `await` rather than a `yield`,
     * which `returnOnDisconnect` cannot reach either way.
     */
    returnOnDisconnect?: boolean;
};
/** Phantom type for SSE streams. On the client, the actual value is an AsyncIterable. */
export type CupleSSEStream<TEvent> = AsyncIterable<TEvent> & {
    result: "success";
    statusCode: 200;
};
type BuilderConfig = {
    app: Express;
    middlewares: Middleware<any, any, any>[];
    finalware?: Finalware<any, any>;
    sseFinalware?: (props: SSEProps<any>) => AsyncGenerator<any>;
    sseOptions?: SSEOptions;
    method?: HttpVerbs;
    path?: string;
    errorHandler?: ErrorHandler;
    bodyParser?: RawBodyParser<any, any> | null;
    meta?: object;
};
type AnyBuilderParams = {
    tMeta: object;
    /** Request input types. Schema methods add properties here. */
    tInput: BaseData;
    /** Handler data. Middleware with `next: true` merges here. */
    tData: BaseData;
    /** Possible responses. Middleware with `next: false` adds here. */
    tResponses: ValidJsonObject;
    /** HTTP method. Set by get/post/put/patch/delete. */
    tMethod: HttpVerbs;
    /** Dependencies for chain(). Validates requirements. */
    tDependencyData: any;
};
type BuilderParams = {
    tMeta: object;
    tInput: BaseData;
    tData: BaseData;
    tResponses: never;
    tMethod: HttpVerbs;
    tDependencyData: object;
};
/**
 * Type-safe Express endpoint builder.
 * Chain methods to add validation and middleware.
 * Finalize with get/post/put/patch/delete.
 */
export declare class Builder<TParams extends AnyBuilderParams = BuilderParams> {
    private config;
    constructor(config: BuilderConfig);
    /** Add custom metadata to the endpoint, e.g. OpenAPI description */
    meta<const T extends {
        description?: string;
        name?: string;
    }>(meta: T): Builder<{
        tMeta: T;
        tInput: TParams["tInput"];
        tData: TParams["tData"];
        tResponses: TParams["tResponses"];
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    rawBody(): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & {
            body: Buffer;
        };
        tData: TParams["tData"];
        tResponses: TParams["tResponses"];
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    rawBody<TData, TInput>(parser: RawBodyParser<TData, TInput>): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & (undefined extends TInput ? {} : {
            body: TInput;
        });
        tData: TParams["tData"] & (undefined extends TData ? {} : {
            body: TData;
        });
        tResponses: TParams["tResponses"];
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /**
     * Add middleware to transform data or return early.
     * `next: true` passes data to next handler.
     * `next: false` ends chain and returns response.
     */
    middleware<TResult extends ValidMiddlewareReturnType>(mw: Middleware<any, TParams["tData"], TResult>): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"];
        tData: TParams["tData"] & TResult & {
            next: true;
        };
        tResponses: TParams["tResponses"] | (TResult extends {
            next: false;
        } ? TResult : never);
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /**
     * Validate request body with Zod schema.
     * Parsed data available in handler as `data.body`.
     */
    bodySchema<TParser extends ZodType<any, any>>(parser: TParser): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & {
            body: z.input<TParser>;
        };
        tData: TParams["tData"] & {
            body: z.output<TParser>;
        };
        tResponses: TParams["tResponses"] | InvalidInput<"body", InputPath<z.input<TParser>>>;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /**
     * Validate query parameters with Zod schema.
     * Parsed data available in handler as `data.query`.
     */
    querySchema<TParser extends ZodType<any, any>>(parser: TParser): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & {
            query: z.input<TParser>;
        };
        tData: TParams["tData"] & {
            query: z.output<TParser>;
        };
        tResponses: TParams["tResponses"] | InvalidInput<"query", InputPath<z.input<TParser>>>;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /**
     * Validate route parameters with Zod schema.
     * Parsed data available in handler as `data.params`.
     */
    paramsSchema<TParser extends ZodType<any, any>>(parser: TParser): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & {
            params: z.input<TParser>;
        };
        tData: TParams["tData"] & {
            params: z.output<TParser>;
        };
        tResponses: TParams["tResponses"] | InvalidInput<"params", InputPath<z.input<TParser>>>;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /**
     * Validate request headers with Zod schema.
     * Parsed data available in handler as `data.headers`.
     * Note: Express lowercases header names (e.g., "Authorization" -> "authorization").
     */
    headersSchema<TParser extends ZodType<any, any>>(parser: TParser): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & {
            headers: z.input<TParser>;
        };
        tData: TParams["tData"] & {
            headers: z.output<TParser>;
        };
        tResponses: TParams["tResponses"] | InvalidInput<"headers", InputPath<z.input<TParser>>>;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }>;
    /** Set route path (e.g., "/users/:id"). */
    path(path: string): Builder<TParams>;
    /**
     * Declare dependency on another chain link's data.
     * Use when building a chain link that requires data
     * from another link (e.g., role check needs auth data).
     */
    expectChain<TChain extends Middleware<any, any, any, any>>(): Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & (TChain extends Middleware<infer TInputIn, any, any, any> ? TInputIn : never);
        tData: TParams["tData"] & (TChain extends Middleware<any, infer TDataIn, any, any> ? TDataIn : never);
        tResponses: (TChain extends Middleware<any, any, infer TRespIn, any> ? TRespIn : never) | TParams["tResponses"];
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"] & (TChain extends Middleware<any, infer TDataIn, any, any> ? TDataIn : never);
    }>;
    /**
     * Add a reusable chain link to the current chain.
     * Chain links are created with buildLink().
     * Validates that required dependencies are satisfied.
     */
    chain<TLinkInput, TLinkData, TLinkResponses, TLinkDependencyData>(link: Middleware<TLinkInput, TLinkData, TLinkResponses, TLinkDependencyData>): TParams["tData"] extends TLinkDependencyData ? Builder<{
        tMeta: TParams["tMeta"];
        tInput: TParams["tInput"] & TLinkInput;
        tData: TParams["tData"] & TLinkData & {
            next: true;
        };
        tResponses: TParams["tResponses"] | (TLinkResponses & {
            next: false;
        });
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
    }> : "Chainlink dependencies are not fulfilled";
    /**
     * Build as reusable chain link.
     * Chain links can be added to other chains with chain().
     */
    buildLink: () => Middleware<TParams["tInput"], TParams["tData"], TParams["tResponses"], TParams["tDependencyData"]>;
    /** How far this chain is built: for running what's after it in-process. */
    get _chain(): {
        middlewares: number;
        inputs: number;
    };
    private _build;
    /** Runs the chain and the finalware: the response, never a rejection. */
    private _buildRun;
    private _register;
    private _endpoint;
    private _buildRaw;
    private _runMiddlewares;
    /** Finalize as GET. Handler returns JSON response. */
    get: <TFinalResponses extends ValidJsonObject>(mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>) => BuiltEndpoint<TParams["tInput"], UnexpectedError | TParams["tResponses"] | TFinalResponses, "get", TParams["tMeta"], "json">;
    /** Finalize as POST. Handler returns JSON response. */
    post: <TFinalResponses extends ValidJsonObject>(mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>) => BuiltEndpoint<TParams["tInput"], UnexpectedError | TParams["tResponses"] | TFinalResponses, "post", TParams["tMeta"], "json">;
    /** Finalize as PATCH. Handler returns JSON response. */
    patch: <TFinalResponses extends ValidJsonObject>(mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>) => BuiltEndpoint<TParams["tInput"], UnexpectedError | TParams["tResponses"] | TFinalResponses, "patch", TParams["tMeta"], "json">;
    /** Finalize as DELETE. Handler returns JSON response. */
    delete: <TFinalResponses extends ValidJsonObject>(mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>) => BuiltEndpoint<TParams["tInput"], UnexpectedError | TParams["tResponses"] | TFinalResponses, "delete", TParams["tMeta"], "json">;
    /** Finalize as PUT. Handler returns JSON response. */
    put: <TFinalResponses extends ValidJsonObject>(mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>) => BuiltEndpoint<TParams["tInput"], UnexpectedError | TParams["tResponses"] | TFinalResponses, "put", TParams["tMeta"], "json">;
    /** Finalize as GET with SSE stream. */
    getSSE: <TEvent extends ValidJsonObject>(mw: (props: SSEProps<TParams["tData"]>) => AsyncGenerator<TEvent, any, any>, options?: SSEOptions) => {
        tMeta: TParams["tMeta"];
        tKind: "sse";
        tInput: WithoutUndefinedProperties<{
            body: TParams["tInput"] extends infer T ? T extends TParams["tInput"] ? T extends {
                body?: unknown;
            } ? T["body"] : undefined : never : never;
            query: TParams["tInput"] extends infer T_1 ? T_1 extends TParams["tInput"] ? T_1 extends {
                query?: unknown;
            } ? T_1["query"] : undefined : never : never;
            params: TParams["tInput"] extends infer T_2 ? T_2 extends TParams["tInput"] ? T_2 extends {
                params?: unknown;
            } ? T_2["params"] : undefined : never : never;
            headers: TParams["tInput"] extends infer T_3 ? T_3 extends TParams["tInput"] ? T_3 extends {
                headers?: unknown;
            } ? T_3["headers"] : undefined : never : never;
        }>;
        tOutput: UnexpectedError | TParams["tResponses"] | CupleSSEStream<TEvent>;
        tMethod: "get";
    } & {
        _handler: (req: ExpressRequest, res: ExpressResponse) => void;
        _method: "get";
        _kind: "sse";
        /** `.meta()`'s object. */
        _meta?: object;
        /** The schemas the chain validates, links included, in order. */
        _inputs: EndpointSchema[];
        /** Whether the body is read by rawBody() rather than as JSON. */
        _rawBody: boolean;
        /** Runs the endpoint without HTTP; only `json` endpoints have it. */
        _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
            statusCode: number;
        } & Record<string, unknown>>;
    } & {
        _sse: true;
    };
    /** Finalize as POST with SSE stream. */
    postSSE: <TEvent extends ValidJsonObject>(mw: (props: SSEProps<TParams["tData"]>) => AsyncGenerator<TEvent, any, any>, options?: SSEOptions) => {
        tMeta: TParams["tMeta"];
        tKind: "sse";
        tInput: WithoutUndefinedProperties<{
            body: TParams["tInput"] extends infer T ? T extends TParams["tInput"] ? T extends {
                body?: unknown;
            } ? T["body"] : undefined : never : never;
            query: TParams["tInput"] extends infer T_1 ? T_1 extends TParams["tInput"] ? T_1 extends {
                query?: unknown;
            } ? T_1["query"] : undefined : never : never;
            params: TParams["tInput"] extends infer T_2 ? T_2 extends TParams["tInput"] ? T_2 extends {
                params?: unknown;
            } ? T_2["params"] : undefined : never : never;
            headers: TParams["tInput"] extends infer T_3 ? T_3 extends TParams["tInput"] ? T_3 extends {
                headers?: unknown;
            } ? T_3["headers"] : undefined : never : never;
        }>;
        tOutput: UnexpectedError | TParams["tResponses"] | CupleSSEStream<TEvent>;
        tMethod: "post";
    } & {
        _handler: (req: ExpressRequest, res: ExpressResponse) => void;
        _method: "post";
        _kind: "sse";
        /** `.meta()`'s object. */
        _meta?: object;
        /** The schemas the chain validates, links included, in order. */
        _inputs: EndpointSchema[];
        /** Whether the body is read by rawBody() rather than as JSON. */
        _rawBody: boolean;
        /** Runs the endpoint without HTTP; only `json` endpoints have it. */
        _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
            statusCode: number;
        } & Record<string, unknown>>;
    } & {
        _sse: true;
    };
    /** Finalize as PUT with SSE stream. */
    putSSE: <TEvent extends ValidJsonObject>(mw: (props: SSEProps<TParams["tData"]>) => AsyncGenerator<TEvent, any, any>, options?: SSEOptions) => {
        tMeta: TParams["tMeta"];
        tKind: "sse";
        tInput: WithoutUndefinedProperties<{
            body: TParams["tInput"] extends infer T ? T extends TParams["tInput"] ? T extends {
                body?: unknown;
            } ? T["body"] : undefined : never : never;
            query: TParams["tInput"] extends infer T_1 ? T_1 extends TParams["tInput"] ? T_1 extends {
                query?: unknown;
            } ? T_1["query"] : undefined : never : never;
            params: TParams["tInput"] extends infer T_2 ? T_2 extends TParams["tInput"] ? T_2 extends {
                params?: unknown;
            } ? T_2["params"] : undefined : never : never;
            headers: TParams["tInput"] extends infer T_3 ? T_3 extends TParams["tInput"] ? T_3 extends {
                headers?: unknown;
            } ? T_3["headers"] : undefined : never : never;
        }>;
        tOutput: UnexpectedError | TParams["tResponses"] | CupleSSEStream<TEvent>;
        tMethod: "put";
    } & {
        _handler: (req: ExpressRequest, res: ExpressResponse) => void;
        _method: "put";
        _kind: "sse";
        /** `.meta()`'s object. */
        _meta?: object;
        /** The schemas the chain validates, links included, in order. */
        _inputs: EndpointSchema[];
        /** Whether the body is read by rawBody() rather than as JSON. */
        _rawBody: boolean;
        /** Runs the endpoint without HTTP; only `json` endpoints have it. */
        _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
            statusCode: number;
        } & Record<string, unknown>>;
    } & {
        _sse: true;
    };
    /** Finalize as PATCH with SSE stream. */
    patchSSE: <TEvent extends ValidJsonObject>(mw: (props: SSEProps<TParams["tData"]>) => AsyncGenerator<TEvent, any, any>, options?: SSEOptions) => {
        tMeta: TParams["tMeta"];
        tKind: "sse";
        tInput: WithoutUndefinedProperties<{
            body: TParams["tInput"] extends infer T ? T extends TParams["tInput"] ? T extends {
                body?: unknown;
            } ? T["body"] : undefined : never : never;
            query: TParams["tInput"] extends infer T_1 ? T_1 extends TParams["tInput"] ? T_1 extends {
                query?: unknown;
            } ? T_1["query"] : undefined : never : never;
            params: TParams["tInput"] extends infer T_2 ? T_2 extends TParams["tInput"] ? T_2 extends {
                params?: unknown;
            } ? T_2["params"] : undefined : never : never;
            headers: TParams["tInput"] extends infer T_3 ? T_3 extends TParams["tInput"] ? T_3 extends {
                headers?: unknown;
            } ? T_3["headers"] : undefined : never : never;
        }>;
        tOutput: UnexpectedError | TParams["tResponses"] | CupleSSEStream<TEvent>;
        tMethod: "patch";
    } & {
        _handler: (req: ExpressRequest, res: ExpressResponse) => void;
        _method: "patch";
        _kind: "sse";
        /** `.meta()`'s object. */
        _meta?: object;
        /** The schemas the chain validates, links included, in order. */
        _inputs: EndpointSchema[];
        /** Whether the body is read by rawBody() rather than as JSON. */
        _rawBody: boolean;
        /** Runs the endpoint without HTTP; only `json` endpoints have it. */
        _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
            statusCode: number;
        } & Record<string, unknown>>;
    } & {
        _sse: true;
    };
    /** Finalize as DELETE with SSE stream. */
    deleteSSE: <TEvent extends ValidJsonObject>(mw: (props: SSEProps<TParams["tData"]>) => AsyncGenerator<TEvent, any, any>, options?: SSEOptions) => {
        tMeta: TParams["tMeta"];
        tKind: "sse";
        tInput: WithoutUndefinedProperties<{
            body: TParams["tInput"] extends infer T ? T extends TParams["tInput"] ? T extends {
                body?: unknown;
            } ? T["body"] : undefined : never : never;
            query: TParams["tInput"] extends infer T_1 ? T_1 extends TParams["tInput"] ? T_1 extends {
                query?: unknown;
            } ? T_1["query"] : undefined : never : never;
            params: TParams["tInput"] extends infer T_2 ? T_2 extends TParams["tInput"] ? T_2 extends {
                params?: unknown;
            } ? T_2["params"] : undefined : never : never;
            headers: TParams["tInput"] extends infer T_3 ? T_3 extends TParams["tInput"] ? T_3 extends {
                headers?: unknown;
            } ? T_3["headers"] : undefined : never : never;
        }>;
        tOutput: UnexpectedError | TParams["tResponses"] | CupleSSEStream<TEvent>;
        tMethod: "delete";
    } & {
        _handler: (req: ExpressRequest, res: ExpressResponse) => void;
        _method: "delete";
        _kind: "sse";
        /** `.meta()`'s object. */
        _meta?: object;
        /** The schemas the chain validates, links included, in order. */
        _inputs: EndpointSchema[];
        /** Whether the body is read by rawBody() rather than as JSON. */
        _rawBody: boolean;
        /** Runs the endpoint without HTTP; only `json` endpoints have it. */
        _invoke?: (input: EndpointInput, options?: InvokeOptions) => Promise<{
            statusCode: number;
        } & Record<string, unknown>>;
    } & {
        _sse: true;
    };
    /**
     * Finalize as GET with raw handler.
     * For streaming, downloads, custom responses.
     * Not compatible with @cuple/client, use fetch.
     */
    getRaw: (mw: Finalware<({
        next: true;
    } & TParams["tData"]) | ({
        next: false;
    } & TParams["tResponses"]), any>) => BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"], TParams["tMeta"], "raw">;
    /**
     * Finalize as POST with raw handler.
     * For streaming, downloads, custom responses.
     * Not compatible with @cuple/client, use fetch.
     */
    postRaw: (mw: Finalware<({
        next: true;
    } & TParams["tData"]) | ({
        next: false;
    } & TParams["tResponses"]), any>) => BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"], TParams["tMeta"], "raw">;
    /**
     * Finalize as PATCH with raw handler.
     * For streaming, downloads, custom responses.
     * Not compatible with @cuple/client, use fetch.
     */
    patchRaw: (mw: Finalware<({
        next: true;
    } & TParams["tData"]) | ({
        next: false;
    } & TParams["tResponses"]), any>) => BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"], TParams["tMeta"], "raw">;
    /**
     * Finalize as DELETE with raw handler.
     * For streaming, downloads, custom responses.
     * Not compatible with @cuple/client, use fetch.
     */
    deleteRaw: (mw: Finalware<({
        next: true;
    } & TParams["tData"]) | ({
        next: false;
    } & TParams["tResponses"]), any>) => BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"], TParams["tMeta"], "raw">;
    /**
     * Finalize as PUT with raw handler.
     * For streaming, downloads, custom responses.
     * Not compatible with @cuple/client, use fetch.
     */
    putRaw: (mw: Finalware<({
        next: true;
    } & TParams["tData"]) | ({
        next: false;
    } & TParams["tResponses"]), any>) => BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"], TParams["tMeta"], "raw">;
    private _getSchemaMiddleware;
    private _buildFinalMiddlewareSetter;
    private _buildFinalMiddlewareSetterRaw;
    private _buildSSEFinalMiddlewareSetter;
    private _buildSSE;
    private _wrapWithBodyParser;
    private _buildMiddleware;
}
/**
 * Create endpoint builder for Express app.
 * @param app - Express application instance
 * @param options - Optional error handler
 */
export declare const createBuilder: (app: Express, options?: Pick<BuilderConfig, "errorHandler">) => Builder<BuilderParams>;
export {};
