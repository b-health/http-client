"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerError = void 0;
// Single source of truth type → HTTP status. The capture policy derives from
// here: 4xx = expected user behavior (not a monitoring signal), 5xx = real
// failure. SCHEMA is 400 and not 403: admin clients interpret 403 as an auth
// failure and trigger a credentials refresh. INVALID-TYPE (contract
// violation, e.g. a malformed queue event) and API (external service failure)
// are bugs/incidents, not user errors: 5xx.
const STATUS_BY_TYPE = {
    RULE: 400,
    SCHEMA: 400,
    UNAUTHORIZED: 401,
    "NOT-FOUND": 404,
    "INVALID-TYPE": 500,
    API: 500,
    UNKNOWN: 500,
};
/**
 * The single error class for handled failures across B.Health services.
 * Consumers with domain-specific vocabulary should subclass it (statics are
 * inherited) instead of forking it.
 */
class ServerError extends Error {
    constructor({ message, type, extraInfo, error, origin, serviceContext, cause, signal }) {
        super(message);
        this.extraInfo = extraInfo;
        this.error = error;
        this.type = type;
        this.origin = origin || "ENTITY";
        this.serviceContext = serviceContext;
        this.signal = signal;
        const chained = cause ?? error;
        if (chained !== undefined)
            this.cause = chained;
        Error.captureStackTrace(this, this.constructor);
    }
    /** HTTP status this error maps to, derived from STATUS_BY_TYPE. */
    get status() {
        return STATUS_BY_TYPE[this.type] ?? 500;
    }
    isUnknown() {
        return this.type === "UNKNOWN";
    }
    isSchema() {
        return this.type === "SCHEMA";
    }
    isUnauthorized() {
        return this.type === "UNAUTHORIZED";
    }
    isFromDB() {
        return this.origin === "DB";
    }
    /**
     * Expected business error: the user got a 4xx and moved on. Not captured
     * by monitoring — the full policy lives in STATUS_BY_TYPE, except for the
     * explicit `signal` override (4xx machine-to-machine that ARE incidents).
     */
    isExpected() {
        if (this.signal !== undefined)
            return !this.signal;
        return this.status < 500;
    }
    hasMessage() {
        return Boolean(this.message);
    }
    static isServerError(error) {
        return error instanceof ServerError;
    }
    /**
     * The single capture decision for a whole service: expected business
     * errors are not a monitoring signal; anything else (unexpected
     * ServerError, native Error, loose value) is.
     */
    static isSignal(error) {
        return !(ServerError.isServerError(error) && error.isExpected());
    }
}
exports.ServerError = ServerError;
