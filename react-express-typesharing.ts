import { z, ZodType } from "zod";
import express, { Request, Response } from "express";
const app = express();

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

const getBuilder = <A = unknown, Response = never>(config: {
  middlewares: any[];
  final_middleware?: any;
  body_parsers: any[];
  method?: "get" | "post" | "put" | "patch" | "delete";
  path?: string;
}) => ({
  body_schema<TParser extends ZodType<any, any, any>>(body_parser: TParser) {
    return getBuilder<A & { body: z.infer<TParser> }, Response>({
      ...config,
      body_parsers: [...config.body_parsers, body_parser],
    });
  },
  middleware<B extends A, C extends Next>(mw: Middleware<B, C>) {
    return getBuilder<C & { next: true }, (C & { next: false }) | Response>({
      ...config,
      middlewares: [...config.middlewares, mw],
    });
  },
  get<B extends A, C>(mw: Middleware<B & { next: true }, C>) {
    return getBuilder<C, Response | C>({
      ...config,
      final_middleware: mw,
      method: "get",
    });
  },
  path(path: string) {
    return getBuilder<A, Response>({
      ...config,
      path,
    });
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

    return app[config.method](config.path, (req, res) => {
      endpoint(req, res).catch((err) => {
        console.error(err);

        res.status(500).send({
          message: "Something went wrong.",
        });
      });
    });
  },
});

export const builder = getBuilder({
  body_parsers: [],
  middlewares: [],
});
