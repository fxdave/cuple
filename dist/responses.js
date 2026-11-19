"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conflict = exports.forbidden = exports.unauthorized = exports.notFound = exports.unexpectedError = exports.invalidInput = exports.success = exports.apiResponse = void 0;
const apiResponse = (result, statusCode, others) => (Object.assign({ result,
    statusCode }, others));
exports.apiResponse = apiResponse;
// Factory methods
const success = (others) => (Object.assign({ result: "success", statusCode: 200 }, others));
exports.success = success;
/**
 * A request part failed validation: `invalid-body`, `invalid-query`,
 * `invalid-params` or `invalid-headers`. Schemas return it on their own; return
 * it from a handler for a rule a schema can't check (an email already in use),
 * so the client handles both the same way.
 */
const invalidInput = (part, issues) => (0, exports.apiResponse)(`invalid-${part}`, 422, {
    message: "We found some incorrect field(s) during validating the form.",
    issues: issues,
});
exports.invalidInput = invalidInput;
const unexpectedError = () => (0, exports.apiResponse)("unexpected-error", 500, {
    message: "Something went wrong. Please try again later.",
});
exports.unexpectedError = unexpectedError;
const statusFactory = (defaultResult, statusCode, defaultMessage) => (options) => {
    var _a, _b;
    return (Object.assign(Object.assign({}, options), { result: (_a = options === null || options === void 0 ? void 0 : options.result) !== null && _a !== void 0 ? _a : defaultResult, statusCode, message: (_b = options === null || options === void 0 ? void 0 : options.message) !== null && _b !== void 0 ? _b : defaultMessage }));
};
/**
 * 404. The result is `not-found` unless you name it: when a route can miss
 * more than one thing, name each (`post-not-found`, `author-not-found`) so the
 * client can tell them apart.
 */
exports.notFound = statusFactory("not-found", 404, "Not found.");
/** 401: the request has no valid credentials. The result is `unauthorized` unless you name it. */
exports.unauthorized = statusFactory("unauthorized", 401, "Please sign in.");
/** 403: the user is known but not allowed. The result is `forbidden` unless you name it. */
exports.forbidden = statusFactory("forbidden", 403, "You don't have permission to do this.");
/** 409: the request clashes with the current state. The result is `conflict` unless you name it (`email-taken`). */
exports.conflict = statusFactory("conflict", 409, "This conflicts with the current state.");
//# sourceMappingURL=responses.js.map