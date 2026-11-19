"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBuilder = exports.Builder = void 0;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const responses_1 = require("./responses");
const inputsOf = (middlewares) => middlewares.flatMap((mw) => { var _a; return (_a = mw._inputs) !== null && _a !== void 0 ? _a : []; });
const DEFAULT_ERROR_HANDLER = ({ err }) => {
    console.error(err);
    return (0, responses_1.unexpectedError)();
};
/**
 * Type-safe Express endpoint builder.
 * Chain methods to add validation and middleware.
 * Finalize with get/post/put/patch/delete.
 */
class Builder {
    constructor(config) {
        /**
         * Build as reusable chain link.
         * Chain links can be added to other chains with chain().
         */
        this.buildLink = this._buildMiddleware;
        /** Finalize as GET. Handler returns JSON response. */
        this.get = this._buildFinalMiddlewareSetter("get");
        /** Finalize as POST. Handler returns JSON response. */
        this.post = this._buildFinalMiddlewareSetter("post");
        /** Finalize as PATCH. Handler returns JSON response. */
        this.patch = this._buildFinalMiddlewareSetter("patch");
        /** Finalize as DELETE. Handler returns JSON response. */
        this.delete = this._buildFinalMiddlewareSetter("delete");
        /** Finalize as PUT. Handler returns JSON response. */
        this.put = this._buildFinalMiddlewareSetter("put");
        /** Finalize as GET with SSE stream. */
        this.getSSE = this._buildSSEFinalMiddlewareSetter("get");
        /** Finalize as POST with SSE stream. */
        this.postSSE = this._buildSSEFinalMiddlewareSetter("post");
        /** Finalize as PUT with SSE stream. */
        this.putSSE = this._buildSSEFinalMiddlewareSetter("put");
        /** Finalize as PATCH with SSE stream. */
        this.patchSSE = this._buildSSEFinalMiddlewareSetter("patch");
        /** Finalize as DELETE with SSE stream. */
        this.deleteSSE = this._buildSSEFinalMiddlewareSetter("delete");
        /**
         * Finalize as GET with raw handler.
         * For streaming, downloads, custom responses.
         * Not compatible with @cuple/client, use fetch.
         */
        this.getRaw = this._buildFinalMiddlewareSetterRaw("get");
        /**
         * Finalize as POST with raw handler.
         * For streaming, downloads, custom responses.
         * Not compatible with @cuple/client, use fetch.
         */
        this.postRaw = this._buildFinalMiddlewareSetterRaw("post");
        /**
         * Finalize as PATCH with raw handler.
         * For streaming, downloads, custom responses.
         * Not compatible with @cuple/client, use fetch.
         */
        this.patchRaw = this._buildFinalMiddlewareSetterRaw("patch");
        /**
         * Finalize as DELETE with raw handler.
         * For streaming, downloads, custom responses.
         * Not compatible with @cuple/client, use fetch.
         */
        this.deleteRaw = this._buildFinalMiddlewareSetterRaw("delete");
        /**
         * Finalize as PUT with raw handler.
         * For streaming, downloads, custom responses.
         * Not compatible with @cuple/client, use fetch.
         */
        this.putRaw = this._buildFinalMiddlewareSetterRaw("put");
        this.config = Object.assign(Object.assign({}, config), { errorHandler: config.errorHandler || DEFAULT_ERROR_HANDLER });
    }
    /** Add custom metadata to the endpoint, e.g. OpenAPI description */
    meta(meta) {
        return new Builder(Object.assign(Object.assign({}, this.config), { meta }));
    }
    rawBody(parser) {
        const middlewares = parser
            ? [
                ...this.config.middlewares,
                (async ({ req }) => ({
                    next: true,
                    body: req.body,
                })),
            ]
            : this.config.middlewares;
        return new Builder(Object.assign(Object.assign({}, this.config), { bodyParser: parser !== null && parser !== void 0 ? parser : null, middlewares }));
    }
    /**
     * Add middleware to transform data or return early.
     * `next: true` passes data to next handler.
     * `next: false` ends chain and returns response.
     */
    middleware(mw) {
        return new Builder(Object.assign(Object.assign({}, this.config), { middlewares: [...this.config.middlewares, mw] }));
    }
    /**
     * Validate request body with Zod schema.
     * Parsed data available in handler as `data.body`.
     */
    bodySchema(parser) {
        return this.middleware(this._getSchemaMiddleware(SchemaType.Body, parser));
    }
    /**
     * Validate query parameters with Zod schema.
     * Parsed data available in handler as `data.query`.
     */
    querySchema(parser) {
        return this.middleware(this._getSchemaMiddleware(SchemaType.Query, parser));
    }
    /**
     * Validate route parameters with Zod schema.
     * Parsed data available in handler as `data.params`.
     */
    paramsSchema(parser) {
        return this.middleware(this._getSchemaMiddleware(SchemaType.Params, parser));
    }
    /**
     * Validate request headers with Zod schema.
     * Parsed data available in handler as `data.headers`.
     * Note: Express lowercases header names (e.g., "Authorization" -> "authorization").
     */
    headersSchema(parser) {
        return this.middleware(this._getSchemaMiddleware(SchemaType.Headers, parser));
    }
    /** Set route path (e.g., "/users/:id"). */
    path(path) {
        return new Builder(Object.assign(Object.assign({}, this.config), { path }));
    }
    /**
     * Declare dependency on another chain link's data.
     * Use when building a chain link that requires data
     * from another link (e.g., role check needs auth data).
     */
    expectChain() {
        return this;
    }
    /**
     * Add a reusable chain link to the current chain.
     * Chain links are created with buildLink().
     * Validates that required dependencies are satisfied.
     */
    chain(link) {
        return new Builder(Object.assign(Object.assign({}, this.config), { middlewares: [...this.config.middlewares, link] }));
    }
    /** How far this chain is built: for running what's after it in-process. */
    get _chain() {
        return {
            middlewares: this.config.middlewares.length,
            inputs: inputsOf(this.config.middlewares).length,
        };
    }
    _build() {
        const run = this._buildRun();
        const handler = this._wrapWithBodyParser((req, res) => {
            void run(req, res, null, 0).then((_a) => {
                var { statusCode } = _a, rest = __rest(_a, ["statusCode"]);
                return res.status(statusCode).send(rest);
            });
        });
        this._register(handler);
        return Object.assign(Object.assign({}, this._endpoint(handler, "json")), { _invoke: (input, options = {}) => {
                var _a, _b, _c;
                return run(requestFor(input, options.req), (_a = options.res) !== null && _a !== void 0 ? _a : ignoredResponse(), (_b = options.data) !== null && _b !== void 0 ? _b : null, (_c = options.skip) !== null && _c !== void 0 ? _c : 0);
            } });
    }
    /** Runs the chain and the finalware: the response, never a rejection. */
    _buildRun() {
        const middlewares = this.config.middlewares;
        return (req, res, data, skip) => this._runMiddlewares(middlewares.slice(skip), { req, res, data })
            .then((response) => {
            if (!response.next)
                return response;
            if (!this.config.finalware)
                throw new MissingFinalwareError();
            return this.config.finalware({ req, res, data: response });
        })
            .then((_a) => {
            var { next } = _a, rest = __rest(_a, ["next"]);
            return rest;
        })
            .catch((err) => this.config.errorHandler({ err, res, req }))
            .catch((err) => {
            console.error("Custom error handler failed, falling back to DEFAULT");
            return DEFAULT_ERROR_HANDLER({ err, res, req });
        });
    }
    _register(handler) {
        if (this.config.method && this.config.path) {
            this.config.app[this.config.method](this.config.path, handler);
        }
    }
    _endpoint(handler, kind) {
        return {
            _handler: handler,
            _method: this.config.method,
            _kind: kind,
            _meta: this.config.meta,
            _inputs: inputsOf(this.config.middlewares),
            _rawBody: this.config.bodyParser !== undefined,
            tInput: undefined,
            tMethod: undefined,
            tOutput: undefined,
            tMeta: undefined,
            tKind: undefined,
        };
    }
    _buildRaw() {
        const endpoint = this._buildMiddleware();
        const coreHandler = (req, res) => {
            endpoint({ req, res, data: null })
                .then((response) => {
                if (typeof response.next !== "boolean")
                    throw new BadMiddlewareReturnTypeError();
                if (!this.config.finalware)
                    throw new MissingFinalwareError();
                return this.config.finalware({ req, res, data: response });
            })
                .catch(() => { });
        };
        const handler = this._wrapWithBodyParser(coreHandler);
        this._register(handler);
        return this._endpoint(handler, "raw");
    }
    async _runMiddlewares(middlewares, { req, res, data }) {
        let actualData = data;
        for (const mw of middlewares) {
            const _a = await mw({ data: actualData, req, res }), { next } = _a, rest = __rest(_a, ["next"]);
            if (typeof next !== "boolean")
                throw new BadMiddlewareReturnTypeError();
            if (!next)
                return Object.assign(Object.assign({}, rest), { next: false });
            actualData = Object.assign(Object.assign({}, actualData), rest);
        }
        return Object.assign(Object.assign({}, actualData), { next: true });
    }
    _getSchemaMiddleware(propertyName, parser) {
        const validate = async ({ req, res, data }) => {
            try {
                let newData = parser.parse(req[propertyName]);
                const existingData = data && data[propertyName];
                if (typeof newData === "object" && typeof existingData === "object") {
                    newData = Object.assign(Object.assign({}, existingData), newData);
                }
                return {
                    [propertyName]: newData,
                    next: true,
                };
            }
            catch (e) {
                if (e instanceof zod_1.ZodError) {
                    return Object.assign(Object.assign({}, (0, responses_1.invalidInput)(propertyName, e.issues)), { next: false });
                }
                const response = this.config.errorHandler({ req, res, err: e });
                return Object.assign(Object.assign({}, response), { next: false });
            }
        };
        const inputs = [{ part: propertyName, schema: parser }];
        return Object.assign(validate, { _inputs: inputs });
    }
    _buildFinalMiddlewareSetter(method) {
        return (mw) => {
            const builder = new Builder(Object.assign(Object.assign({}, this.config), { finalware: mw, method }));
            return builder._build();
        };
    }
    _buildFinalMiddlewareSetterRaw(method) {
        return (mw) => {
            const builder = new Builder(Object.assign(Object.assign({}, this.config), { finalware: mw, method }));
            return builder._buildRaw();
        };
    }
    _buildSSEFinalMiddlewareSetter(method) {
        return (mw, options) => {
            const builder = new Builder(Object.assign(Object.assign({}, this.config), { sseFinalware: mw, sseOptions: options, method }));
            return builder._buildSSE();
        };
    }
    _buildSSE() {
        const endpoint = this._buildMiddleware();
        const coreHandler = (req, res) => {
            endpoint({ req, res, data: null })
                .then(async (response) => {
                var _a, e_1, _b, _c;
                var _d;
                if (typeof response.next !== "boolean")
                    throw new BadMiddlewareReturnTypeError();
                if (!response.next) {
                    // Middleware rejected - send JSON error
                    const { next, statusCode } = response, rest = __rest(response, ["next", "statusCode"]);
                    res.status(statusCode).send(rest);
                    return;
                }
                if (!this.config.sseFinalware)
                    throw new MissingFinalwareError();
                // Set SSE headers
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
                res.flushHeaders();
                // A comment, which clients ignore. Proxies (Vite's dev server among
                // them) hold the headers until the first body bytes, so without it a
                // quiet stream looks unanswered, and a browser queues other tabs'
                // identical requests behind it.
                res.write(":\n\n");
                // Fired on disconnect whatever `returnOnDisconnect` says: that option
                // governs whether we close the generator, not what the handler is told.
                const disconnected = new AbortController();
                req.on("close", () => disconnected.abort());
                const generator = this.config.sseFinalware({
                    req,
                    res,
                    data: response,
                    disconnectSignal: disconnected.signal,
                });
                const returnOnDisconnect = ((_d = this.config.sseOptions) === null || _d === void 0 ? void 0 : _d.returnOnDisconnect) !== false;
                if (returnOnDisconnect) {
                    req.on("close", () => {
                        generator.return(undefined);
                    });
                }
                try {
                    try {
                        for (var _e = true, generator_1 = __asyncValues(generator), generator_1_1; generator_1_1 = await generator_1.next(), _a = generator_1_1.done, !_a; _e = true) {
                            _c = generator_1_1.value;
                            _e = false;
                            const event = _c;
                            res.write(`data: ${JSON.stringify(event)}\n\n`);
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (!_e && !_a && (_b = generator_1.return)) await _b.call(generator_1);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                }
                catch (err) {
                    // If headers already sent, just end
                    if (!res.headersSent) {
                        const _f = this.config.errorHandler({ err, res, req }), { statusCode } = _f, rest = __rest(_f, ["statusCode"]);
                        res.status(statusCode).send(rest);
                        return;
                    }
                }
                res.end();
            })
                .catch((err) => {
                if (!res.headersSent) {
                    const _a = this.config.errorHandler({ err, res, req }), { statusCode } = _a, rest = __rest(_a, ["statusCode"]);
                    res.status(statusCode).send(rest);
                }
                else {
                    res.end();
                }
            });
        };
        const handler = this._wrapWithBodyParser(coreHandler);
        this._register(handler);
        return Object.assign(Object.assign({}, this._endpoint(handler, "sse")), { _sse: true });
    }
    _wrapWithBodyParser(coreHandler) {
        var _a, _b;
        if (this.config.bodyParser === null) {
            return coreHandler;
        }
        const middleware = (_b = (_a = this.config.bodyParser) === null || _a === void 0 ? void 0 : _a._expressMiddleware) !== null && _b !== void 0 ? _b : express_1.default.json();
        return (req, res) => {
            middleware(req, res, () => coreHandler(req, res));
        };
    }
    _buildMiddleware() {
        const middlewares = this.config.middlewares;
        const link = (props) => this._runMiddlewares(middlewares, props);
        return Object.assign(link, { _inputs: inputsOf(middlewares) });
    }
}
exports.Builder = Builder;
/**
 * The request an in-process call runs on: `base`'s, with the input's parts as
 * own properties, since Express defines some of them as getters.
 */
function requestFor(input, base) {
    var _a;
    const req = Object.create(base !== null && base !== void 0 ? base : null);
    for (const part of ["body", "query", "params", "headers"]) {
        Object.defineProperty(req, part, {
            value: (_a = input[part]) !== null && _a !== void 0 ? _a : (part === "body" ? undefined : {}),
            writable: true,
            configurable: true,
            enumerable: true,
        });
    }
    return req;
}
/** A response for in-process calls: what a middleware sets on it goes nowhere. */
function ignoredResponse() {
    const res = new Proxy({ locals: {}, headersSent: false }, {
        get: (target, key) => (key in target ? target[key] : () => res),
    });
    return res;
}
var SchemaType;
(function (SchemaType) {
    SchemaType["Body"] = "body";
    SchemaType["Query"] = "query";
    SchemaType["Params"] = "params";
    SchemaType["Headers"] = "headers";
})(SchemaType || (SchemaType = {}));
/**
 * Create endpoint builder for Express app.
 * @param app - Express application instance
 * @param options - Optional error handler
 */
const createBuilder = (app, options) => new Builder(Object.assign({ app, middlewares: [] }, options));
exports.createBuilder = createBuilder;
class BadMiddlewareReturnTypeError extends Error {
    constructor() {
        super('Every middleware should return an object with a "next" boolean attribute');
    }
}
class MissingFinalwareError extends Error {
    constructor() {
        super("You have to use get/put/delete/post/patch at the end of the middleware chain");
    }
}
//# sourceMappingURL=builder.js.map