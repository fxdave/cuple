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
  TInput extends object,
  TResponses,
  TMethod extends HttpVerbs,
> = ApiCaller<
  TInput extends { body?: unknown } ? TInput["body"] : undefined,
  TInput extends { query?: unknown } ? TInput["query"] : undefined,
  TInput extends { params?: unknown } ? TInput["params"] : undefined,
  TInput extends { headers?: unknown } ? TInput["headers"] : undefined,
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

type ValidJson =
  | undefined // undefined means no property, it's here for compatibilitys with other types like "statusCode?: number"
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
  tInput: BaseData;
  tData: BaseData;
  tResponses: ValidJsonObject;
  tMethod: HttpVerbs;
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
 * @template TData - The data object that you can use in request handlers
 * @template TResponses - The possible responses that the endpoint can produce
 */
export class Builder<TParams extends AnyBuilderParams = BuilderParams> {
  private config: BuilderConfig & { errorHandler: ErrorHandler };

  constructor(config: BuilderConfig) {
    this.config = {
      ...config,
      errorHandler: config.errorHandler || DEFAULT_ERROR_HANDLER,
    };
  }

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
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Body, parser)) as any;
  }

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
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Query, parser)) as any;
  }

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
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Params, parser)) as any;
  }

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
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Headers, parser)) as any;
  }

  path(path: string) {
    return new Builder<TParams>({
      ...this.config,
      path,
    });
  }

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

  buildLink = this.__buildMiddleware;

  build(): BuiltEndpoint<TParams["tInput"], TParams["tResponses"], TParams["tMethod"]> {
    const endpoint = this.__buildMiddleware();

    const handler = (req: ExpressRequest, res: ExpressResponse) => {
      endpoint({ req, res, data: null as any })
        .then((response) => {
          if (typeof response.next !== "boolean")
            throw new BadMiddlewareReturnTypeError();
          if (!response.next) return response;
          if (!this.config.finalware) throw new MissingFinalwareError();
          return this.config.finalware({ req, res, data: response });
        })
        .then((response) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { next, statusCode, ...rest } = response;
          res.status(statusCode).send(rest);
        })
        .catch((err) => {
          const { statusCode, ...rest } = this.config.errorHandler({ err, res, req });
          res.status(statusCode).send(rest);
        })
        .catch((err) => {
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

  private __getSchemaMiddleware<
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

  private __buildFinalMiddlewareSetter<TMethod extends HttpVerbs>(method: TMethod) {
    return <TFinalResponses extends ValidJsonObject>(
      mw: Finalware<TParams["tData"], TParams["tResponses"] | TFinalResponses>,
    ) => {
      const builder = new Builder<{
        tInput: TParams["tInput"];
        tData: TParams["tData"];
        tResponses: TFinalResponses | TParams["tResponses"] | UnexpectedError;
        tMethod: TParams["tMethod"];
        tDependencyData: TParams["tDependencyData"];
      }>({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder.build();
    };
  }

  private __buildMiddleware(): Middleware<
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
