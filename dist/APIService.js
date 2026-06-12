"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIService = void 0;
const axios_1 = __importDefault(require("axios"));
const perf_hooks_1 = require("perf_hooks");
const ServerError_1 = require("./ServerError");
const httpLogger_1 = require("./httpLogger");
const throttledPromises_1 = require("./throttledPromises");
const MAX_SERIALIZED_BYTES = 4096;
// Deep-copy for safe transport, capping size: upstream error pages can be
// multi-MB HTML, serialized several times per error — without a cap the
// error path becomes the process's memory hotspot exactly during an outage.
const safeSerialize = (value, maxBytes = MAX_SERIALIZED_BYTES) => {
    try {
        const json = JSON.stringify(value);
        if (json === undefined)
            return undefined;
        if (json.length <= maxBytes)
            return JSON.parse(json);
        return { truncated: true, preview: json.slice(0, maxBytes) };
    }
    catch {
        return { unserializable: true };
    }
};
// Upstream response headers worth keeping for diagnostics. Everything else
// is dropped — set-cookie and auth-ish headers can carry live credentials.
const SAFE_RESPONSE_HEADERS = new Set([
    "content-type",
    "content-length",
    "retry-after",
    "x-request-id",
    "x-amzn-requestid",
    "date",
]);
const pickSafeHeaders = (headers) => {
    if (!headers || typeof headers !== "object")
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase()))
            out[key] = String(value);
    }
    return out;
};
// The raw AxiosError carries config.headers (Authorization: Bearer ...) and
// config.data (request body — PHI in this platform). It must never leave the
// library: chain a synthetic error that keeps the diagnostic value (message,
// stack, code, name) and nothing else.
const sanitizedCause = (error) => {
    const cause = new Error(error.message);
    cause.name = error.name;
    if (error.stack)
        cause.stack = error.stack;
    cause.code = error.code;
    return cause;
};
/** Upstream detail embedded in the (user-visible) message is capped at this length. */
const MAX_MESSAGE_DETAIL = 300;
/** Applied when RequestOptions.timeout is omitted. Pass 0 to disable the timeout. */
const DEFAULT_TIMEOUT_MS = 1000;
const createInstance = (options) => {
    return axios_1.default.create({
        baseURL: options.baseURL,
        timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
        headers: {
            "Content-Type": "application/json",
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.headers ? options.headers : {}),
        },
        ...(options.httpAgent ? { httpAgent: options.httpAgent } : {}),
        ...(options.httpsAgent ? { httpsAgent: options.httpsAgent } : {}),
        ...(options.maxBodyLength !== undefined ? { maxBodyLength: options.maxBodyLength } : {}),
        ...(options.maxContentLength !== undefined ? { maxContentLength: options.maxContentLength } : {}),
    });
};
const logBenchmark = (method, url, startTime, endTime) => {
    // Telemetry must never sit on the data path: a throwing host logger would
    // turn an already-successful request (the POST happened) into a failure.
    try {
        const duration = endTime - startTime;
        (0, httpLogger_1.getHttpLogger)()?.info({
            title: "APISERVICE TIME:",
            description: `[${method}] ${url} took ${duration.toFixed(2)}ms`,
        });
    }
    catch {
        // swallow: losing one breadcrumb beats failing a succeeded request
    }
};
const request = async (method, options) => {
    const startTime = perf_hooks_1.performance.now();
    const axiosInstance = createInstance(options);
    const config = { params: options.query };
    let response;
    switch (method) {
        case "GET":
            response = await axiosInstance.get(options.url, config);
            break;
        case "POST":
            response = await axiosInstance.post(options.url, options.body, config);
            break;
        case "PUT":
            response = await axiosInstance.put(options.url, options.body, config);
            break;
        case "PATCH":
            response = await axiosInstance.patch(options.url, options.body, config);
            break;
        case "DELETE":
            response = await axiosInstance.delete(options.url, {
                ...config,
                ...(options.body ? { data: options.body } : {}),
            });
            break;
    }
    if (!options.silent)
        logBenchmark(method, options.url, startTime, perf_hooks_1.performance.now());
    return response.data;
};
/**
 * Translate a caught error into a classified ServerError.
 *
 * Axios errors: 4xx upstream = business answer from the external service
 * (RULE — not a monitoring signal). 5xx or no response (timeout, DNS,
 * refused connection) = external service failure (API — a signal,
 * distinguishable from our own bugs which stay UNKNOWN). `code` (e.g.
 * ECONNABORTED, ERR_BAD_RESPONSE) always travels in serviceContext: type
 * says WHO failed, code says HOW.
 *
 * Non-axios errors are NOT blamed on the external service: an already
 * classified ServerError passes through untouched, anything else becomes
 * UNKNOWN (a bug in the consumer's own code reached this catch).
 *
 * Sanitization contract: the chained `cause` is a synthetic error (message,
 * stack, code) — never the raw AxiosError, whose config carries the
 * Authorization header and request body. `responseData` is truncated and
 * `responseHeaders` allowlisted before entering serviceContext.
 */
const handleError = (error, service) => {
    if (!error) {
        return new ServerError_1.ServerError({
            message: "Unknown error occurred",
            type: "UNKNOWN",
            origin: "SERVICE",
            error: null,
        });
    }
    // Already classified upstream — re-wrapping would destroy its type.
    if (ServerError_1.ServerError.isServerError(error))
        return error;
    // Not an axios failure: a defect in our own code reached this catch.
    // Classifying it as API would blame the external service for our bug.
    if (!axios_1.default.isAxiosError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        return new ServerError_1.ServerError({
            message: message || "Unknown error occurred",
            type: "UNKNOWN",
            origin: "SERVICE",
            error: safeSerialize(error),
            cause: error,
        });
    }
    const baseContext = {
        service: service ?? "API",
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        method: error.config?.method,
        code: error.code,
    };
    if (error.response) {
        const responseData = error.response.data;
        let message = service ? `Error from ${service}` : "Error from API";
        if (responseData) {
            // responseData may be a string OR an object — and its `message` field may
            // itself be an object. Anything non-string interpolated via template
            // literal yields "[object Object]", which hides the real cause:
            // serialize explicitly so the message stays informative.
            const upstreamMessage = responseData.message;
            const detail = typeof responseData === "string"
                ? responseData
                : typeof upstreamMessage === "string" && upstreamMessage
                    ? upstreamMessage
                    : JSON.stringify(safeSerialize(responseData));
            // message is user-visible for RULE/API types: cap upstream detail so a
            // whole error page never reaches the client response.
            const capped = detail.length > MAX_MESSAGE_DETAIL ? `${detail.slice(0, MAX_MESSAGE_DETAIL)}…` : detail;
            message = `${message} - "${capped}"`;
        }
        return new ServerError_1.ServerError({
            message,
            type: error.response.status >= 400 && error.response.status < 500 ? "RULE" : "API",
            origin: "SERVICE",
            error: safeSerialize(error.response.data),
            cause: sanitizedCause(error),
            serviceContext: {
                ...baseContext,
                status: error.response.status,
                statusText: error.response.statusText,
                responseData: safeSerialize(error.response.data),
                responseHeaders: pickSafeHeaders(error.response.headers),
            },
        });
    }
    return new ServerError_1.ServerError({
        message: error.message || "Unknown error occurred",
        type: "API",
        origin: "SERVICE",
        cause: sanitizedCause(error),
        serviceContext: baseContext,
    });
};
exports.APIService = {
    get: (options) => request("GET", options),
    post: (options) => request("POST", options),
    put: (options) => request("PUT", options),
    patch: (options) => request("PATCH", options),
    delete: (options) => request("DELETE", options),
    handleError,
    throttledPromises: throttledPromises_1.throttledPromises,
};
