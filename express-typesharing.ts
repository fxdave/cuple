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

/**
 * @template TData - The data object that you can use in request handlers
 * @template TResponses - The possible responses that the endpoint can produce
 */
class Builder<TData = unknown, TResponses = unknown> {
  constructor(private config: BuilderConfig) {}

  middleware<TResult extends Next>(mw: Middleware<TData, TResult>) {
    return new Builder<
      // The consequent TData will be merged with TResult only when { next: TRUE }
      TData & TResult & { next: true },
      // The consequent TResponses can be TResult only when { next: FALSE }
      TResponses | (TResult & { next: false })
    >({
      ...this.config,
      middlewares: [...this.config.middlewares, mw],
    });
  }

  bodySchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(this.__getSchemaMiddleware(SchemaType.Body, parser));
  }

  querySchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(
      this.__getSchemaMiddleware(SchemaType.Query, parser)
    );
  }

  paramsSchema<TParser extends ZodType<any, any, any>>(parser: TParser) {
    return this.middleware(
      this.__getSchemaMiddleware(SchemaType.Params, parser)
    );
  }

  path(path: string) {
    return new Builder<TData, TResponses>({ ...this.config, path });
  }

  chain<TLinkData, TLinkResponses>(
    link: Middleware<TLinkData, TLinkResponses>
  ) {
    return new Builder<
      TData & TLinkData & { next: true },
      TResponses | (TLinkResponses & { next: false })
    >({
      ...this.config,
      middlewares: [...this.config.middlewares, link],
    });
  }

  buildLink = this.__buildMiddleware;

  build(): Endpoint<TData, TResponses> {
    const endpoint = this.__buildMiddleware();

    if (!this.config.method) {
      throw new Error("Method is required");
    }
    if (!this.config.path) {
      throw new Error("Path is required");
    }

    return this.config.app[this.config.method](this.config.path, (req, res) => {
      endpoint({ req, res, data: null as any })
        .then((response) => {
          if (typeof response.next !== "boolean")
            throw new BadMiddlewareReturnTypeError();
          if (!response.next) return response;
          if (!this.config.finalware) throw new MissingFinalwareError();
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
    TPropertyName extends SchemaType,
    TParser extends ZodType<any, any, any>
  >(
    propertyName: TPropertyName,
    parser: TParser
  ): Middleware<
    TData,
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
    return <TFinalResponses>(
      mw: Finalware<TData, TResponses | TFinalResponses>
    ) => {
      const builder = new Builder<TData, TResponses | TFinalResponses>({
        ...this.config,
        finalware: mw,
        method,
      });

      return builder.build()
    };
  }

  private __buildMiddleware(): Middleware<TData, TResponses> {
    return async ({
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

enum SchemaType {
  Body = "body",
  Query = "query",
  Params = "params"
}

export const createBuilder = (app: Express) =>
  new Builder({
    app,
    middlewares: [],
  });

class BadMiddlewareReturnTypeError extends Error {
  constructor() {
    super(
      'Every middleware should return an object with a "next" boolean attribute'
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
