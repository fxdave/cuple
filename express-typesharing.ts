import { TypeOf, z, ZodError, ZodType } from "zod";
import { Request, Response, Express } from "express";
import {
  ImprovedZodIssue,
  UnexpectedError,
  unexpectedError,
  ZodValidationError,
  zodValidationError,
} from "./express-typesharing-responses";

type ExpressRequest = Request;
type ExpressResponse = Response;

type MiddlewareProps<TData> = {
  data: TData;
  req: ExpressRequest;
  res: ExpressResponse;
};

type Middleware<TData, TResult> = (
  props: MiddlewareProps<TData>
) => Promise<TResult & ({ next: true } | { next: false; statusCode: number })>;

/** The last middleware */
type Finalware<TData, TResult> = (
  props: MiddlewareProps<TData>
) => Promise<TResult>;

/** An express compatible request handler */
type Endpoint<TRequest, TResponse> = (
  req: ExpressRequest,
  res: ExpressResponse
) => Promise<{
  statusCode: number;
  data: TResponse;
}> & { _phantomData?: { request: TRequest; response: TResponse } };

/** Middlewares should include next, which tells the handler to continue */
type Next = { next: true | false };
type HttpVerbs = "get" | "post" | "put" | "patch" | "delete";

type BuilderConfig = {
  app: Express;
  middlewares: Middleware<any, any>[];
  finalware?: Finalware<any, any>;
  method?: HttpVerbs;
  path?: string;
};

type SchemaMiddlewareResponse<
  TSchemaMiddleware extends (...args: any[]) => any
> = Awaited<ReturnType<ReturnType<TSchemaMiddleware>>>;
class Builder<TInput = unknown, TOutput = unknown> {
  constructor(private config: BuilderConfig) {}

  middleware<C extends Next>(mw: Middleware<TInput, C>) {
    return new Builder<
      TInput & C & { next: true },
      (C & { next: false }) | TOutput
    >({
      ...this.config,
      middlewares: [...this.config.middlewares, mw],
    });
  }

  bodySchema<TParser extends ZodType<any, any, any>>(bodyParser: TParser) {
    return new Builder<
      TInput &
        SchemaMiddlewareResponse<
          typeof this.__getSchemaMiddleware<SchemaTypes.Body, TParser>
        > & { next: true },
      | (SchemaMiddlewareResponse<
          typeof this.__getSchemaMiddleware<SchemaTypes.Body, TParser>
        > & { next: false })
      | TOutput
    >({
      ...this.config,
      middlewares: [
        ...this.config.middlewares,
        this.__getSchemaMiddleware(SchemaTypes.Body, bodyParser),
      ],
    });
  }

  querySchema<TParser extends ZodType<any, any, any>>(queryParser: TParser) {
    return new Builder<
      TInput &
        SchemaMiddlewareResponse<
          typeof this.__getSchemaMiddleware<SchemaTypes.Query, TParser>
        > & { next: true },
      | (SchemaMiddlewareResponse<
          typeof this.__getSchemaMiddleware<SchemaTypes.Query, TParser>
        > & { next: false })
      | TOutput
    >({
      ...this.config,
      middlewares: [
        ...this.config.middlewares,
        this.__getSchemaMiddleware(SchemaTypes.Query, queryParser),
      ],
    });
  }

  path(path: string) {
    return new Builder<TInput, TOutput>({ ...this.config, path });
  }

  chain<TReq, TRes>(mw: Middleware<TReq, TRes>) {
    return new Builder<
      TReq & { next: true },
      (TRes & { next: false }) | TOutput
    >({
      ...this.config,
      middlewares: [...this.config.middlewares, mw],
    });
  }

  buildLink = this.__buildMiddleware;

  build(): Endpoint<TInput, TOutput> {
    const endpoint = this.__buildMiddleware();

    if (!this.config.method) {
      throw new Error("Path is required");
    }
    if (!this.config.path) {
      throw new Error("Path is required");
    }

    return this.config.app[this.config.method](this.config.path, (req, res) => {
      endpoint({ req, res, data: null as any })
        .then((response) => {
          if (typeof response.next !== "boolean")
            throw new BadMiddlewareReturnTypeError();

          if (!response.next) {
            return response;
          }

          if (!this.config.finalware) {
            throw new MissingFinalwareError();
          }
          return this.config.finalware({ req, res, data: response });
        })
        .then((response) => {
          const { next, statusCode, ...rest } = response;
          res.status(statusCode).send(rest);
        })
        .catch((err) => {
          console.error(err);

          res.status(500).send({
            message: "Something went wrong.",
          });
        });
    });
  }

  get = this.__buildFinalMiddlewareSetter("get");
  post = this.__buildFinalMiddlewareSetter("post");
  patch = this.__buildFinalMiddlewareSetter("patch");
  delete = this.__buildFinalMiddlewareSetter("delete");
  put = this.__buildFinalMiddlewareSetter("put");

  private __getSchemaMiddleware<
    TPropertyName extends SchemaTypes,
    TParser extends ZodType<any, any, any>
  >(
    propertyName: TPropertyName,
    parser: TParser
  ): Middleware<
    TInput,
    | ({ [i in TPropertyName]: z.infer<TParser> } & { next: true })
    | (ZodValidationError<z.infer<TParser>> & { next: false })
    | (UnexpectedError & { next: false })
  > {
    return async ({ req }: MiddlewareProps<unknown>) => {
      try {
        return {
          [propertyName]: parser.parse(req[propertyName]) as z.infer<TParser>,
          next: true as const,
        };
      } catch (e) {
        if (e instanceof ZodError) {
          return {
            ...zodValidationError(
              e.issues as ImprovedZodIssue<TypeOf<TParser>>[]
            ),
            next: false as const,
          };
        }
        return {
          ...unexpectedError(),
          next: false as const,
        };
      }
    };
  }

  private __buildFinalMiddlewareSetter(method: HttpVerbs) {
    return <B extends TInput, C>(
      mw: Finalware<B & { next: true }, C | TOutput>
    ) => {
      return new Builder<B & { next: true }, TOutput | C>({
        ...this.config,
        finalware: mw,
        method,
      });
    };
  }

  private __buildMiddleware(): Middleware<TInput, TOutput> {
    return async <TData>({
      req,
      res,
      data,
    }: {
      req: ExpressRequest;
      res: ExpressResponse;
      data: TData;
    }) => {
      let actualData = data;
      for (let mw of this.config.middlewares) {
        const { next, ...rest } = await mw({ data: actualData, req, res });
        if (typeof next !== "boolean") throw new BadMiddlewareReturnTypeError();
        if (!next) return { ...rest, next: false };
        actualData = { ...actualData, ...rest };
      }
      return { ...actualData, next: true };
    };
  }
}

enum SchemaTypes {
  Body = "body",
  Query = "query",
}

export const createBuilder = (app: Express) =>
  new Builder({
    app,
    middlewares: [],
  });

class BadMiddlewareReturnTypeError extends Error {
  constructor() {
    super(
      'Every middleware should return an object with a "next" bool attribute'
    );
  }
}
class MissingFinalwareError extends Error {
  constructor() {
    super(
      "You have to use get/put/delete/post/patch at the end of the middleware chain"
    );
  }
}
