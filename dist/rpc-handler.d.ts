import type { Express } from "express";
export type InitRpcConfig = {
    path: string;
    routes: RecursiveApi;
};
type RecursiveApi = {
    [Key in string]: {
        tInput: any;
        tOutput: any;
        tMethod: any;
        _handler: (req: any, res: any) => void;
        _method: any;
    } | RecursiveApi;
};
export declare function initRpc(app: Express, config: InitRpcConfig): void;
export {};
