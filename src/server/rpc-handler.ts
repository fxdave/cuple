import express from "express";
import { Express } from "express";
import { ApiCaller, BuiltEndpoint } from "./builder";

type InitRpcConfig = {
  path: string;
  routes: RecursiveApi;
};

type RecursiveApi = {
  [Key in string]: ApiCaller<any, any, any, any, any> | RecursiveApi;
};

export function initRpc(app: Express, config: InitRpcConfig) {
  app.post(config.path, express.json(), (req, res) => {
    console.log(req.body);
    
    req.params = req.body.params.params;
    req.query = req.body.params.query;
    if (req.body.params.headers)
      Object.apply(req.headers, req.body.params.headers);

    let endpoint: BuiltEndpoint<any, any> = config.routes as any;
    for (let segment of req.body.segments) {
      endpoint = (endpoint as any)[segment] as any;
    }

    req.body = req.body.params.body;
    endpoint.handler(req, res);
  });
}
