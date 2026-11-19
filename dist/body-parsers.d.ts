import express, { type Request, type Response } from "express";
export type RawBodyParser<TData, TInput = TData> = {
    _expressMiddleware: (req: Request, res: Response, next: () => void) => void;
    _phantomData?: TData;
    _phantomInput?: TInput;
};
export declare function buffer(options?: Parameters<typeof express.raw>[0]): RawBodyParser<Buffer, Buffer>;
export declare function json(options?: Parameters<typeof express.json>[0]): RawBodyParser<undefined, undefined>;
