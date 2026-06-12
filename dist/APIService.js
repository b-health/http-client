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
const safeSerialize = (value) => {
    try {
        return JSON.parse(JSON.stringify(value));
    }
    catch {
        return { unserializable: true };
    }
};
const createInstance = (options) => {
    return axios_1.default.create({
        baseURL: options.baseURL,
        timeout: options.timeout || 1000,
        headers: {
            "Content-Type": "application/json",
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.headers ? options.headers : {}),
        },
        ...(options.httpAgent ? { httpAgent: options.httpAgent } : {}),
        ...(options.httpsAgent ? { httpsAgent: options.httpsAgent } : {}),
        ...(options.maxBodyLength ? { maxBodyLength: options.maxBodyLength } : {}),
    });
};
const logBenchmark = (method, url, startTime, endTime) => {
    const duration = endTime - startTime;
    (0, httpLogger_1.getHttpLogger)()?.info({
        title: "APISERVICE TIME:",
        description: `[${method}] ${url} took ${duration.toFixed(2)}ms`,
    });
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
 * Translate an AxiosError into a classified ServerError.
 *
 * 4xx upstream = business answer from the external service (RULE — not a
 * monitoring signal). 5xx or no response (timeout, DNS, refused connection) =
 * real failure (UNKNOWN), carrying the request context the monitoring
 * boundary would not have otherwise, with the original AxiosError chained
 * via `cause`.
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
    if (error.response) {
        const responseData = error.response.data;
        let message = service ? `Error from ${service}` : "Error from API";
        if (responseData) {
            // responseData may be a string OR an object. Stringifying an object via
            // template literals yields "[object Object]", which hides the real
            // cause — serialize it explicitly so the message stays informative.
            const detail = typeof responseData === "string"
                ? responseData
                : responseData.message || JSON.stringify(safeSerialize(responseData));
            message = `${message} - "${detail}"`;
        }
        return new ServerError_1.ServerError({
            message,
            type: error.response.status >= 400 && error.response.status < 500 ? "RULE" : "UNKNOWN",
            origin: "SERVICE",
            error: error.response.data,
            cause: error,
            serviceContext: {
                service: service ?? "API",
                url: error.config?.url,
                baseURL: error.config?.baseURL,
                method: error.config?.method,
                status: error.response.status,
                statusText: error.response.statusText,
                responseData: safeSerialize(error.response.data),
                responseHeaders: safeSerialize(error.response.headers),
            },
        });
    }
    return new ServerError_1.ServerError({
        message: error.message || "Unknown error occurred",
        type: "UNKNOWN",
        origin: "SERVICE",
        error: error,
        cause: error,
        serviceContext: {
            service: service ?? "API",
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            method: error.config?.method,
            code: error.code,
        },
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
