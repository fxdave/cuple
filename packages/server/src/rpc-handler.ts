import express, { Request, Response } from "express";
import { Express } from "express";
import { BuiltEndpoint } from "./builder";

export type InitRpcConfig = {
  path: string;
  routes: RecursiveApi;
};

type RecursiveApi = {
  [Key in string]:
    | {
        tInput: any;
        tOutput: any;
        tMethod: any;
        _handler: (req: any, res: any) => void;
        _method: any;
      }
    | RecursiveApi;
};

export function initRpc(app: Express, config: InitRpcConfig) {
  const createRpcHandler = (method: string) => (req: Request, res: Response) => {
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
    for (const segment of requestInto.segments) {
      endpoint = (endpoint as any)[segment] as any;
    }

    if (method !== endpoint._method) {
      return res.status(400).send({
        message: "Method not allowed",
      });
    }

    req.body = requestInto.argument.body;
    endpoint._handler(req, res);
  };

  app.get(config.path, express.json(), createRpcHandler("get"));
  app.post(config.path, express.json(), createRpcHandler("post"));
  app.put(config.path, express.json(), createRpcHandler("put"));
  app.patch(config.path, express.json(), createRpcHandler("patch"));
  app.delete(config.path, express.json(), createRpcHandler("delete"));
}
