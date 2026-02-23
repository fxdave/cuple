import { Request, Response } from "express";
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
    let rpcData;
    if (method === "get" || method === "delete") {
      rpcData = JSON.parse((req.query.data as string) || "{}");
      Object.defineProperty(req, "body", {
        value: rpcData.body,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      rpcData = JSON.parse((req.headers["x-cuple-rpc"] as string) || "{}");
    }

    // Direct assignment (e.g. req.query = ...) does not work for getter-only properties.
    // Using Object.defineProperty creates an own property on the instance that shadows the prototype getter.
    Object.defineProperty(req, "params", {
      value: rpcData.params || {},
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(req, "query", {
      value: rpcData.query || {},
      writable: true,
      configurable: true,
      enumerable: true,
    });

    let endpoint: BuiltEndpoint<any, any, any, any> = config.routes as any;
    for (const segment of rpcData.segments) {
      endpoint = (endpoint as any)[segment] as any;
    }

    if (method !== endpoint._method) {
      return res.status(400).send({
        message: "Method not allowed",
      });
    }

    endpoint._handler(req, res);
  };

  app.get(config.path, createRpcHandler("get"));
  app.post(config.path, createRpcHandler("post"));
  app.put(config.path, createRpcHandler("put"));
  app.patch(config.path, createRpcHandler("patch"));
  app.delete(config.path, createRpcHandler("delete"));
}
