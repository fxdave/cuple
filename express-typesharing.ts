import { z, ZodError, ZodType } from "zod";
import express, { Request, Response, Express } from "express";
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
type Middleware<TData, TResult> = (props: MiddlewareProps<TData>) => TResult;
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
  final_middleware?: any;
  body_parsers: any[];
  method?: HttpVerbs;
  path?: string;
}) => {
  function buildFinalMiddlewareSetter(method: HttpVerbs) {
    return <B extends A, C>(
      mw: Middleware<B & { next: true }, C | Response>
    ) => {
      return getBuilder<C, Response | C>({
        ...config,
        final_middleware: mw,
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
    <TParser extends ZodType<any, any, any>>(body_parser: TParser) =>
    async ({ req }) => {
      try {
        return {
          body: body_parser.parse(req.body) as z.infer<TParser>,
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

  return {
    body_schema<TParser extends ZodType<any, any, any>>(body_parser: TParser) {
      return getBuilder<
        A & BodySchemaMiddlewareResponse<TParser> & { next: true },
        (BodySchemaMiddlewareResponse<TParser> & { next: false }) | Response
      >({
        ...config,
        middlewares: [
          ...config.middlewares,
          getBodySchemaMiddleware(body_parser),
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
    chain<TReq, TRes>(mw: Endpoint<TReq, TRes>) {
      return getBuilder<
        TReq & { next: true },
        (TRes & { next: false }) | Response
      >({
        ...config,
        middlewares: [...config.middlewares, mw],
      });
    },

    build(): Endpoint<A, Response> {
      const endpoint = async (req: ExpressRequest, res: ExpressResponse) => {
        let data: any = null;

        // 1. walk through middlewares
        for (let mw of config.middlewares) {
          const result = mw({ data, req, res });
          if (!result.next) {
            delete result.next;
            res.status(result.statusCode).send(result);
            return;
          }
          delete result.next;
          data = { ...data, ...result };
        }

        // 2. Call final middleware, in case it is needed
        if (config.final_middleware) {
          const final_data = config.final_middleware({ data, req, res });
          const statusCode = final_data.statusCode;
          delete final_data.statusCode;
          res.status(statusCode).send(final_data);
        }
      };

      if (!config.method) {
        // TODO: make this to a compile time error
        throw new Error("Method is required");
      }
      if (!config.path) {
        // TODO: make this to a compile time error
        throw new Error("Path is required");
      }

      return config.app[config.method](config.path, (req, res) => {
        endpoint(req, res).catch((err) => {
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
    body_parsers: [],
    middlewares: [],
  });
