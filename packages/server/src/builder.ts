import z, { ZodError, ZodType } from "zod";
import { Request, Response, Express } from "express";
import {
  UnexpectedError,
  unexpectedError,
  ZodValidationError,
  zodValidationError,
} from "./responses";

type ExpressRequest = Request;
type ExpressResponse = Response;

type MiddlewareProps<TData> = {
  data: TData;
  req: ExpressRequest;
  res: ExpressResponse;
};

type BaseData = object;

type Middleware<TInput, TData, TResult, TDependecyData = any> = (
  props: MiddlewareProps<TData>,
) => Promise<TResult & ({ next: true } | { next: false; statusCode: number })>;

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

/**
 * Built endpoint with server and client types.
 * Runtime data: `handler` and `method`.
 * ApiCaller is typing only for @cuple/client.
 */
export type BuiltEndpoint<
  TInput extends object,
  TResponses,
  TMethod extends HttpVerbs,
> = {
  tInput: WithoutUndefinedProperties<{
    body: TInput extends { body?: unknown } ? TInput["body"] : undefined;
    query: TInput extends { query?: unknown } ? TInput["query"] : undefined;
    params: TInput extends { params?: unknown } ? TInput["params"] : undefined;
    headers: TInput extends { headers?: unknown } ? TInput["headers"] : undefined;
  }>;
  tOutput: TResponses;
  tMethod: TMethod;
} & {
  _handler: (req: ExpressRequest, res: ExpressResponse) => void;
  _method: TMethod;
};

type HttpVerbs = "get" | "post" | "put" | "patch" | "delete";

type ErrorHandler = (data: {
  err: unknown;
  req: ExpressRequest;
  res: ExpressResponse;
}) => UnexpectedError;

const DEFAULT_ERROR_HANDLER: ErrorHandler = ({ err }) => {
  console.error(err);
  return unexpectedError();
};

type ValidJson =
  | undefined // undefined means no property
  | null
  | string
  | number
  | boolean
  | ValidJson[]
  | { [K in string]: ValidJson };
type ValidJsonObject = { [K in string]: ValidJson };
type ValidMiddlewareReturnType = ValidJsonObject & {
  next: true | false;
  statusCode?: number;
};
type ValidInputOrError<T> = T extends ValidJson
  ? T
  : { _: "You can only use JSON types" };

type BuilderConfig = {
  app: Express;
  middlewares: Middleware<any, any, any>[];
  finalware?: Finalware<any, any>;
  method?: HttpVerbs;
  path?: string;
  errorHandler?: ErrorHandler;
};

type AnyBuilderParams = {
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
export class Builder<TParams extends AnyBuilderParams = BuilderParams> {
  private config: BuilderConfig & { errorHandler: ErrorHandler };

  constructor(config: BuilderConfig) {
    this.config = {
      ...config,
      errorHandler: config.errorHandler || DEFAULT_ERROR_HANDLER,
    };
  }

  /**
   * Add middleware to transform data or return early.
   * `next: true` passes data to next handler.
   * `next: false` ends chain and returns response.
   */
  middleware<TResult extends ValidMiddlewareReturnType>(
    mw: Middleware<any, TParams["tData"], TResult>,
  ) {
    return new Builder<{
      // Keep the current input, if we need to update it, we have to do manually.
      // Infering inputs from middleware is not possible.
      tInput: TParams["tInput"];
      // The consequent TData will be merged with TResult only when { next: TRUE }
      tData: TParams["tData"] & TResult & { next: true };
      // The consequent TResponses can be TResult only when { next: FALSE }
      tResponses: TParams["tResponses"] | (TResult & { next: false });
      tMethod: TParams["tMethod"];
      tDependencyData: TParams["tDependencyData"];
    }>({
      ...this.config,
      middlewares: [...this.config.middlewares, mw],
    });
  }

  /**
   * Validate request body with Zod schema.
   * Parsed data available in handler as `data.body`.
   */
  bodySchema<TParser extends ZodType<any, any>>(
    parser: TParser,
  ): Builder<{
    tInput: TParams["tInput"] & { [SchemaType.Body]: z.input<TParser> };
    // The consequent TData will be merged with TResult only when { next: TRUE }
    tData: TParams["tData"] & {
      [SchemaType.Body]: z.output<TParser>;
    };
    // The consequent TResponses can be TResult only when { next: FALSE }
    tResponses: TParams["tResponses"] | ZodValidationError;
    tMethod: TParams["tMethod"];
    tDependencyData: TParams["tDependencyData"];
  }> {
    return this.middleware(this._getSchemaMiddleware(SchemaType.Body, parser)) as any;
  }

  /**
   * Validate query parameters with Zod schema.
   * Parsed data available in handler as `data.query`.
   */
  querySchema<TParser extends ZodType<any, any>>(
    parser: TParser,
  ): Builder<{
    tInput: TParams["tInput"] & { [SchemaType.Query]: z.input<TParser> };
    // The consequent TData will be merged with TResult only when { next: TRUE }
    tData: TParams["tData"] & {
      [SchemaType.Query]: z.output<TParser>;
    };
    // The consequent TResponses can be TResult only when { next: FALSE }
    tResponses: TParams["tResponses"] | ZodValidationError;
    tMethod: TParams["tMethod"];
    tDependencyData: TParams["tDependencyData"];
  }> {
    return this.middleware(this._getSchemaMiddleware(SchemaType.Query, parser)) as any;
  }

  /**
   * Validate route parameters with Zod schema.
   * Parsed data available in handler as `data.params`.
   */
  paramsSchema<TParser extends ZodType<any, any>>(
    parser: TParser,
  ): Builder<{
    tInput: TParams["tInput"] & { [SchemaType.Params]: z.input<TParser> };
    // The consequent TData will be merged with TResult only when { next: TRUE }
    tData: TParams["tData"] & {
      [SchemaType.Params]: z.output<TParser>;
    };
    // The consequent TResponses can be TResult only when { next: FALSE }
    tResponses: TParams["tResponses"] | ZodValidationError;
    tMethod: TParams["tMethod"];
    tDependencyData: TParams["tDependencyData"];
  }> {
    return this.middleware(this._getSchemaMiddleware(SchemaType.Params, parser)) as any;
  }

  /**
   * Validate request headers with Zod schema.
   * Parsed data available in handler as `data.headers`.
   * Note: Express lowercases header names (e.g., "Authorization" -> "authorization").
   */
  headersSchema<TParser extends ZodType<any, any>>(
    parser: TParser,
  ): Builder<{
    tInput: TParams["tInput"] & { [SchemaType.Headers]: z.input<TParser> };
    // The consequent TData will be merged with TResult only when { next: TRUE }
    tData: TParams["tData"] & {
      [SchemaType.Headers]: z.output<TParser>;
    };
    // The consequent TResponses can be TResult only when { next: FALSE }
    tResponses: TParams["tResponses"] | ZodValidationError;
    tMethod: TParams["tMethod"];
    tDependencyData: TParams["tDependencyData"];
  }> {
    return this.middleware(this._getSchemaMiddleware(SchemaType.Headers, parser)) as any;
  }

  /** Set route path (e.g., "/users/:id"). */
  path(path: string) {
    return new Builder<TParams>({
      ...this.config,
      path,
    });
  }

  /**
   * Declare dependency on another chain link's data.
   * Use when building a chain link that requires data
   * from another link (e.g., role check needs auth data).
   */
  expectChain<TChain extends Middleware<any, any, any, any>>() {
    type TInputIncoming =
      TChain extends Middleware<infer TInputIn, any, any> ? TInputIn : never;
    type TDataIncoming =
      TChain extends Middleware<any, infer TDataIn, any> ? TDataIn : never;
    type TResponsesIncoming =
      TChain extends Middleware<any, any, infer TRespIn> ? TRespIn : never;

    return this as unknown as Builder<{
      tInput: TParams["tInput"] & TInputIncoming;
      // The consequent TData will be merged with TResult only when { next: TRUE }
      tData: TParams["tData"] & TDataIncoming;
      // The consequent TResponses can be TResult only when { next: FALSE }
      tResponses: TResponsesIncoming | TParams["tResponses"];
      tMethod: TParams["tMethod"];
      tDependencyData: TParams["tDependencyData"] & TDataIncoming;
    }>;
  }

  /**
   * Add a reusable chain link to the current chain.
   * Chain links are created with buildLink().
   * Validates that required dependencies are satisfied.
   */
  chain<TLinkInput, TLinkData, TLinkResponses, TLinkDependencyData>(
    link: Middleware<TLinkInput, TLinkData, TLinkResponses, TLinkDependencyData>,
  ) {
    type AssertedBuilderType = TParams["tData"] extends TLinkDependencyData
      ? Builder<{
          tInput: TParams["tInput"] & TLinkInput;
          tData: TParams["tData"] & TLinkData & { next: true };
          tResponses: TParams["tResponses"] | (TLinkResponses & { next: false });
          tMethod: TParams["tMethod"];
          tDependencyData: TParams["tDependencyData"];
        }>
      : "Chainlink dependencies are not fulfilled";
    return new Builder({
      ...this.config,
      middlewares: [...this.config.middlewares, link],
    }) as AssertedBuilderType;
  }

  /**
   * Build as reusable chain link.
   * Chain links can be added to other chains with chain().
   */
  buildLink = this._buildMiddleware;

  private _build(): BuiltEndpoint<
    TParams["tInput"],
    TParams["tResponses"],
    TParams["tMethod"]
  > {
    return this._buildRaw(false);
  }

  private _buildRaw(
    isRawHandler: boolean = true,
  ): BuiltEndpoint<TParams["tInput"], any, TParams["tMethod"]> {
    const endpoint = this._buildMiddleware();

    const handler = (req: ExpressRequest, res: ExpressResponse) => {
      endpoint({ req, res, data: null as any })
        .then((response) => {
          if (typeof response.next !== "boolean")
            throw new BadMiddlewareReturnTypeError();
          if (!isRawHandler && !response.next) return response;
          if (!this.config.finalware) throw new MissingFinalwareError();
          return this.config.finalware({ req, res, data: response });
        })
        .then((response) => {
          if (isRawHandler) return;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { next, statusCode, ...rest } = response;
          res.status(statusCode).send(rest);
        })
        .catch((err: unknown) => {
          if (isRawHandler) return;
          const { statusCode, ...rest } = this.config.errorHandler({ err, res, req });
          res.status(statusCode).send(rest);
        })
        .catch((err: unknown) => {
          console.error("Custom error handler failed, falling back to DEFAULT");
          const { statusCode, ...rest } = DEFAULT_ERROR_HANDLER({ err, res, req });
          res.status(statusCode).send(rest);
        });
    };

    if (this.config.method && this.config.path) {
      this.config.app[this.config.method](this.config.path, handler);
    }

    return {
      _handler: handler,
      _method: this.config.method!,
      tInput: undefined as any,
      tMethod: undefined as any,
      tOutput: undefined as any,
    };
  }

  /** Finalize as GET. Handler returns JSON response. */
  get = this._buildFinalMiddlewareSetter("get");
  /** Finalize as POST. Handler returns JSON response. */
  post = this._buildFinalMiddlewareSetter("post");
  /** Finalize as PATCH. Handler returns JSON response. */
  patch = this._buildFinalMiddlewareSetter("patch");
  /** Finalize as DELETE. Handler returns JSON response. */
  delete = this._buildFinalMiddlewareSetter("delete");
  /** Finalize as PUT. Handler returns JSON response. */
  put = this._buildFinalMiddlewareSetter("put");

  /**
   * Finalize as GET with raw handler.
   * For streaming, downloads, custom responses.
   * Not compatible with @cuple/client, use fetch.
   */
  getRaw = this._buildFinalMiddlewareSetterRaw("get");
  /**
   * Finalize as POST with raw handler.
   * For streaming, downloads, custom responses.
   * Not compatible with @cuple/client, use fetch.
   */
  postRaw = this._buildFinalMiddlewareSetterRaw("post");
  /**
   * Finalize as PATCH with raw handler.
   * For streaming, downloads, custom responses.
   * Not compatible with @cuple/client, use fetch.
   */
  patchRaw = this._buildFinalMiddlewareSetterRaw("patch");
  /**
   * Finalize as DELETE with raw handler.
   * For streaming, downloads, custom responses.
   * Not compatible with @cuple/client, use fetch.
   */
  deleteRaw = this._buildFinalMiddlewareSetterRaw("delete");
  /**
   * Finalize as PUT with raw handler.
   * For streaming, downloads, custom responses.
   * Not compatible with @cuple/client, use fetch.
   */
  putRaw = this._buildFinalMiddlewareSetterRaw("put");

  private _getSchemaMiddleware<
    TPropertyName extends SchemaType,
    TParser extends ZodType<any, any>,
  >(
    propertyName: TPropertyName,
    parser: TParser,
  ): Middleware<
    TParams["tInput"] & z.input<TParser>,
    TParams["tData"],
    | ({ [i in TPropertyName]: ValidInputOrError<z.input<TParser>> } & { next: true })
    | (ZodValidationError & { next: false })
    | (UnexpectedError & { next: false })
  > {
    return async ({ req, res, data }: MiddlewareProps<unknown>) => {
      try {
        let newData = parser.parse(req[propertyName]);
        const existingData = data && (data as any)[propertyName];
        if (typeof newData === "object" && typeof existingData === "object") {
          newData = {
            ...existingData,
            ...newData,
          };
        }
        return {
          [propertyName]: newData,
          next: true as const,
        } as { [i in TPropertyName]: z.output<TParser> } & { next: true };
      } catch (e) {
        if (e instanceof ZodError) {
          return {
            ...zodValidationError(e.issues),
            next: false as const,
          } as ZodValidationError & { next: false };
        }

        const response = this.config.errorHandler({ req, res, err: e });
        return {
          ...response,
          next: false as const,
        } as UnexpectedError & { next: false };
      }
    };
  }

  private _buildFinalMiddlewareSetter<TMethod extends HttpVerbs>(method: TMethod) {
    return <TFinalResponses extends ValidJsonObject>(
      mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>,
    ) => {
      const builder = new Builder<{
        tInput: TParams["tInput"];
        tData: TParams["tData"];
        tResponses: TFinalResponses | TParams["tResponses"] | UnexpectedError;
        tMethod: TMethod;
        tDependencyData: TParams["tDependencyData"];
      }>({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder._build();
    };
  }

  private _buildFinalMiddlewareSetterRaw<TMethod extends HttpVerbs>(method: TMethod) {
    return (
      mw: Finalware<
        ({ next: true } & TParams["tData"]) | ({ next: false } & TParams["tResponses"]),
        any
      >,
    ) => {
      const builder = new Builder<{
        tInput: TParams["tInput"];
        tData: TParams["tData"];
        tResponses: any;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
      }>({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder._buildRaw();
    };
  }

  private _buildMiddleware(): Middleware<
    TParams["tInput"],
    TParams["tData"],
    TParams["tResponses"],
    TParams["tDependencyData"]
  > {
    return async ({
      req,
      res,
      data,
    }: {
      req: ExpressRequest;
      res: ExpressResponse;
      data: TParams["tData"];
    }) => {
      let actualData = data;
      for (const mw of this.config.middlewares) {
        const { next, ...rest } = await mw({ data: actualData, req, res });
        if (typeof next !== "boolean") throw new BadMiddlewareReturnTypeError();
        if (!next) return { ...rest, next: false };
        actualData = { ...actualData, ...rest };
      }
      return { ...actualData, next: true };
    };
  }
}

enum SchemaType {
  Body = "body",
  Query = "query",
  Params = "params",
  Headers = "headers",
}

/**
 * Create endpoint builder for Express app.
 * @param app - Express application instance
 * @param options - Optional error handler
 */
export const createBuilder = (
  app: Express,
  options?: Pick<BuilderConfig, "errorHandler">,
) =>
  new Builder({
    app,
    middlewares: [],
    ...options,
  });

class BadMiddlewareReturnTypeError extends Error {
  constructor() {
    super('Every middleware should return an object with a "next" boolean attribute');
  }
}
class MissingFinalwareError extends Error {
  constructor() {
    super("You have to use get/put/delete/post/patch at the end of the middleware chain");
  }
}
