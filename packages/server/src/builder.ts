import { TypeOf, z, ZodError, ZodType } from "zod";
import { Request, Response, Express } from "express";
import {
  ImprovedZodIssue,
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

// We could tidy array items,
// but tuples and arrays are not differentiated,
// and we can't do the same for tuples.
// So arrays will be skipped.
type Tidied_Step1_Array<T> = T extends Array<infer V> ? T : Tidied_Step2_ZodError<T>;
type Tidied_Step2_ZodError<T> =
  T extends ZodValidationError<infer V>
    ? unknown extends V
      ? Tidied_Step3_Object<T>
      : Record<string, unknown> extends V
        ? Tidied_Step3_Object<T>
        : ZodValidationError<V>
    : Tidied_Step3_Object<T>;
type Tidied_Step3_Object<T> = T extends object ? { [i in keyof T]: Tidied<T[i]> } : T;
/** Tidy type by merging intersections, hiding complex type under a name, to improve developer experience */
type Tidied<T> = Tidied_Step1_Array<T>;

type BaseData = object;

type Middleware<TData, TResult, TDependecyData = any> = (
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

export type ApiCaller<
  TRequestBody,
  TRequestQuery,
  TRequestParams,
  TRequestHeaders,
  TResponse,
  TMethod extends HttpVerbs,
> = {
  [Key in TMethod]: (
    params: WithoutUndefinedProperties<{
      body: TRequestBody;
      query: TRequestQuery;
      params: TRequestParams;
      headers: TRequestHeaders;
    }>,
  ) => Promise<TResponse>;
};

export type BuiltEndpoint<
  TData extends BaseData,
  TResponses,
  TMethod extends HttpVerbs,
> = ApiCaller<
  TData extends { body?: unknown } ? TData["body"] : undefined,
  TData extends { query?: unknown } ? TData["query"] : undefined,
  TData extends { params?: unknown } ? TData["params"] : undefined,
  TData extends { headers?: unknown } ? TData["headers"] : undefined,
  TResponses,
  TMethod
> & {
  handler: (req: ExpressRequest, res: ExpressResponse) => void;
  method: HttpVerbs;
};

/** Middlewares should include next, which tells the handler to continue */
type Next = { next: true | false };
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

type BuilderConfig = {
  app: Express;
  middlewares: Middleware<any, any>[];
  finalware?: Finalware<any, any>;
  method?: HttpVerbs;
  path?: string;
  errorHandler?: ErrorHandler;
};

/**
 * @template TData - The data object that you can use in request handlers
 * @template TResponses - The possible responses that the endpoint can produce
 */
export class Builder<
  TData extends BaseData,
  TResponses = never,
  TMethod extends HttpVerbs = "post",
  TDependencyData = any,
> {
  private config: BuilderConfig & { errorHandler: ErrorHandler };

  constructor(config: BuilderConfig) {
    this.config = {
      ...config,
      errorHandler: config.errorHandler || DEFAULT_ERROR_HANDLER,
    };
  }

  middleware<TResult extends Next>(mw: Middleware<TData, TResult>) {
    return new Builder<
      // The consequent TData will be merged with TResult only when { next: TRUE }
      Tidied<TData & TResult & { next: true }>,
      // The consequent TResponses can be TResult only when { next: FALSE }
      TResponses | (TResult & { next: false }),
      TMethod,
      TDependencyData
    >({
      ...this.config,
      middlewares: [...this.config.middlewares, mw],
    });
  }

  bodySchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Body, parser));
  }

  querySchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Query, parser));
  }

  paramsSchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Params, parser));
  }

  headersSchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Headers, parser));
  }

  path(path: string) {
    return new Builder<TData, TResponses, TMethod, TDependencyData>({
      ...this.config,
      path,
    });
  }

  expectChain<TChain extends Middleware<any, any, any>>() {
    type TDataIncoming = TChain extends Middleware<infer TDataIn, any> ? TDataIn : never;
    type TResponsesIncoming =
      TChain extends Middleware<any, infer TRespIn> ? TRespIn : never;

    return this as unknown as Builder<
      TData & TDataIncoming,
      TResponsesIncoming | TResponses,
      TMethod,
      TDataIncoming
    >;
  }

  chain<TLinkData, TLinkResponses, TLinkDependencyData>(
    link: Middleware<TLinkData, TLinkResponses, TLinkDependencyData>,
  ) {
    type AssertedBuilderType = TData extends TLinkDependencyData
      ? Builder<
          TData & TLinkData & { next: true },
          TResponses | (TLinkResponses & { next: false }),
          TMethod
        >
      : "Chainlink dependencies are not fulfilled";
    return new Builder({
      ...this.config,
      middlewares: [...this.config.middlewares, link],
    }) as AssertedBuilderType;
  }

  buildLink = this.__buildMiddleware;

  build(): BuiltEndpoint<Tidied<TData>, Tidied<TResponses>, TMethod> {
    return this.buildRaw(false);
  }

  buildRaw(isRawHandler: boolean = true): BuiltEndpoint<Tidied<TData>, any, TMethod> {
    const endpoint = this.__buildMiddleware();

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

    return { handler, method: this.config.method } as any;
  }

  get = this.__buildFinalMiddlewareSetter("get");
  post = this.__buildFinalMiddlewareSetter("post");
  patch = this.__buildFinalMiddlewareSetter("patch");
  delete = this.__buildFinalMiddlewareSetter("delete");
  put = this.__buildFinalMiddlewareSetter("put");

  /** raw handler gives you more control over the response, but it's not type-safe */
  getRaw = this.__buildFinalMiddlewareSetterRaw("get");
  /** raw handler gives you more control over the response, but it's not type-safe */
  postRaw = this.__buildFinalMiddlewareSetterRaw("post");
  /** raw handler gives you more control over the response, but it's not type-safe */
  patchRaw = this.__buildFinalMiddlewareSetterRaw("patch");
  /** raw handler gives you more control over the response, but it's not type-safe */
  deleteRaw = this.__buildFinalMiddlewareSetterRaw("delete");
  /** raw handler gives you more control over the response, but it's not type-safe */
  putRaw = this.__buildFinalMiddlewareSetterRaw("put");

  private __getSchemaMiddleware<
    TPropertyName extends SchemaType,
    TParser extends ZodType<any, any, any>,
  >(
    propertyName: TPropertyName,
    parser: TParser,
  ): Middleware<
    TData,
    | Tidied<{ [i in TPropertyName]: z.infer<TParser> } & { next: true }>
    | (ZodValidationError<z.infer<TParser>> & { next: false })
    | (UnexpectedError & { next: false })
  > {
    return async ({ req, res, data }: MiddlewareProps<unknown>) => {
      try {
        let newData = parser.parse(req[propertyName]) as z.infer<TParser>;
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
        } as Tidied<{ [i in TPropertyName]: z.infer<TParser> } & { next: true }>;
      } catch (e) {
        if (e instanceof ZodError) {
          return {
            ...zodValidationError(e.issues as ImprovedZodIssue<TypeOf<TParser>>[]),
            next: false as const,
          } as ZodValidationError<z.infer<TParser>> & { next: false };
        }

        const response = this.config.errorHandler({ req, res, err: e });
        return {
          ...response,
          next: false as const,
        } as UnexpectedError & { next: false };
      }
    };
  }

  private __buildFinalMiddlewareSetter<TMethod extends HttpVerbs>(method: TMethod) {
    return <TFinalResponses>(mw: Finalware<TData, TFinalResponses>) => {
      const builder = new Builder<
        TData,
        TFinalResponses | TResponses | UnexpectedError,
        TMethod
      >({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder.build();
    };
  }

  private __buildFinalMiddlewareSetterRaw<TMethod extends HttpVerbs>(method: TMethod) {
    return (
      mw: Finalware<({ next: true } & TData) | ({ next: false } & TResponses), void>,
    ) => {
      const builder = new Builder<
        ({ next: true } & TData) | ({ next: false } & TResponses),
        any,
        TMethod
      >({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder.buildRaw();
    };
  }

  private __buildMiddleware(): Middleware<
    Tidied<TData>,
    Tidied<TResponses>,
    TDependencyData
  > {
    return async ({
      req,
      res,
      data,
    }: {
      req: ExpressRequest;
      res: ExpressResponse;
      data: Tidied<TData>;
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
