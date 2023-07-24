import { z, ZodError, ZodType } from "zod";
import { Request, Response, Express } from "express";
import {
  ImprovedZodIssue,
  unexpectedError,
  zodValidationError,
} from "./express-typesharing-responses";

type ExpressRequest = Request; // TODO
type ExpressResponse = Response; // TODO
type MiddlewareProps<TData> = {
  data: TData;
  req: ExpressRequest;
  res: ExpressResponse;
};
type Middleware<TData, TResult> = (
  props: MiddlewareProps<TData>
) => Promise<TResult>;
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
const getBuilder = <A = unknown, Response = never>(config: {
  app: Express;
  middlewares: any[];
  finalMiddleware?: any;
  bodyParsers: any[];
  method?: HttpVerbs;
  path?: string;
}) => {
  function buildFinalMiddlewareSetter(method: HttpVerbs) {
    return <B extends A, C>(
      mw: Middleware<B & { next: true }, C | Response>
    ) => {
      return getBuilder<C, Response | C>({
        ...config,
        finalMiddleware: mw,
        method,
      });
    };
  }

  function middleware<C extends Next>(mw: Middleware<A, C>) {
    return getBuilder<A & C & { next: true }, (C & { next: false }) | Response>(
      {
        ...config,
        middlewares: [...config.middlewares, mw],
      }
    );
  }

  const getBodySchemaMiddleware =
    <TParser extends ZodType<any, any, any>>(bodyParser: TParser) =>
    async ({ req }) => {
      try {
        return {
          body: bodyParser.parse(req.body) as z.infer<TParser>,
          next: true as const,
        };
      } catch (e) {
        if (e instanceof ZodError) {
          return {
            ...zodValidationError(e.issues as ImprovedZodIssue<any>[]),
            next: false as const,
          };
        }
        return {
          ...unexpectedError(),
          next: false as const,
        };
      }
    };

  const getQuerySchemaMiddleware =
    <TParser extends ZodType<any, any, any>>(queryParser: TParser) =>
    async ({ req }) => {
      try {
        return {
          query: queryParser.parse(req.query) as z.infer<TParser>,
          next: true as const,
        };
      } catch (e) {
        if (e instanceof ZodError) {
          return {
            ...zodValidationError(e.issues as ImprovedZodIssue<any>[]),
            next: false as const,
          };
        }
        return {
          ...unexpectedError(),
          next: false as const,
        };
      }
    };

  type BodySchemaMiddlewareResponse<TParser extends ZodType<any, any, any>> =
    Awaited<ReturnType<ReturnType<typeof getBodySchemaMiddleware<TParser>>>>;
  type QuerySchemaMiddlewareResponse<TParser extends ZodType<any, any, any>> =
    Awaited<ReturnType<ReturnType<typeof getQuerySchemaMiddleware<TParser>>>>;

  function buildMiddleware() {
    return (async <TData>({
      req,
      res,
      data,
    }: {
      req: ExpressRequest;
      res: ExpressResponse;
      data: TData;
    }) => {
      let actualData = data;
      for (let mw of config.middlewares) {
        const result = await mw({ data: actualData, req, res });
        if (!result.next) {
          return result;
        }
        delete result.next;
        actualData = { ...actualData, ...result };
      }

      return {
        ...actualData,
        next: true,
      };
    }) as Middleware<A, Response>;
  }

  return {
    bodySchema<TParser extends ZodType<any, any, any>>(bodyParser: TParser) {
      return getBuilder<
        A & BodySchemaMiddlewareResponse<TParser> & { next: true },
        (BodySchemaMiddlewareResponse<TParser> & { next: false }) | Response
      >({
        ...config,
        middlewares: [
          ...config.middlewares,
          getBodySchemaMiddleware(bodyParser),
        ],
      });
    },
    querySchema<TParser extends ZodType<any, any, any>>(queryParser: TParser) {
      return getBuilder<
        A & QuerySchemaMiddlewareResponse<TParser> & { next: true },
        (QuerySchemaMiddlewareResponse<TParser> & { next: false }) | Response
      >({
        ...config,
        middlewares: [
          ...config.middlewares,
          getQuerySchemaMiddleware(queryParser),
        ],
      });
    },
    middleware,
    get: buildFinalMiddlewareSetter("get"),
    post: buildFinalMiddlewareSetter("post"),
    patch: buildFinalMiddlewareSetter("patch"),
    delete: buildFinalMiddlewareSetter("delete"),
    put: buildFinalMiddlewareSetter("put"),
    path(path: string) {
      return getBuilder<A, Response>({ ...config, path });
    },
    chain<TReq, TRes>(mw: Middleware<TReq, TRes>) {
      return getBuilder<
        TReq & { next: true },
        (TRes & { next: false }) | Response
      >({
        ...config,
        middlewares: [...config.middlewares, mw],
      });
    },

    buildLink(): Middleware<A, Response> {
      return buildMiddleware();
    },

    build(): Endpoint<A, Response> {
      const endpoint = buildMiddleware();

      if (!config.method) {
        throw new Error("Path is required");
      }
      if (!config.path) {
        throw new Error("Path is required");
      }

      return config.app[config.method](config.path, (req, res) => {
        endpoint({ req, res, data: null as any })
          .then((response) => {
            if (!config.finalMiddleware) {
              throw new Error(
                "You have to use get/put/delete/post/patch at the end of the middleware chain"
              );
            }
            return config.finalMiddleware({ req, res, data: response });
          })
          .then((response) => {
            const statusCode = response.statusCode;
            delete response.statusCode;
            delete response.next;

            res.status(statusCode).send(response);
          })
          .catch((err) => {
            console.error(err);

            res.status(500).send({
              message: "Something went wrong.",
            });
          });
      });
    },
  };
};

export const createBuilder = (app: Express) =>
  getBuilder({
    app,
    bodyParsers: [],
    middlewares: [],
  });
