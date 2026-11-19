"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buffer = buffer;
exports.json = json;
const express_1 = __importDefault(require("express"));
function buffer(options) {
    return {
        _expressMiddleware: express_1.default.raw(Object.assign({ type: () => true }, options)),
    };
}
function json(options) {
    return {
        _expressMiddleware: express_1.default.json(options),
    };
}
//# sourceMappingURL=body-parsers.js.map