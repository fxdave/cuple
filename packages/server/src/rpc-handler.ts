import express, { Request, Response } from "express";
import { Express } from "express";
import { ApiCaller, BuiltEndpoint } from "./builder";

type InitRpcConfig = {
  path: string;
  routes: RecursiveApi;
};

type RecursiveApi = {
  [Key in string]: ApiCaller<any, any, any, any, any, any> | RecursiveApi;
};

export function initRpc(app: Express, config: InitRpcConfig) {
  const createRpcHandler =
    (method: string) => (req: Request, res: Response) => {
      let requestInto;
      if (method === "get" || method === "delete") {
        requestInto = JSON.parse((req.query.data as string) || "");
      } else {
        requestInto = req.body;
      }
      req.params = requestInto.argument.params;
      req.query = requestInto.argument.query;
      if (requestInto.argument.headers)
        Object.assign(req.headers, requestInto.argument.headers);

      let endpoint: BuiltEndpoint<any, any, any> = config.routes as any;
      for (let segment of requestInto.segments) {
        endpoint = (endpoint as any)[segment] as any;
      }

      if (method !== endpoint.method) {
        return res.status(400).send({
          message: "Method not allowed",
        });
      }

      req.body = requestInto.argument.body;
      endpoint.handler(req, res);
    };

  app.get(config.path, express.json(), createRpcHandler("get"));
  app.post(config.path, express.json(), createRpcHandler("post"));
  app.put(config.path, express.json(), createRpcHandler("put"));
  app.patch(config.path, express.json(), createRpcHandler("patch"));
  app.delete(config.path, express.json(), createRpcHandler("delete"));
}
