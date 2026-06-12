/**
 * Error classification vocabulary. Each type maps to exactly one HTTP status
 * (see STATUS_BY_TYPE) — the capture policy derives from that mapping.
 */
export type ErrorT = "UNKNOWN" | "RULE" | "SCHEMA" | "NOT-FOUND" | "API" | "UNAUTHORIZED" | "INVALID-TYPE";
/** Layer where the error originated. */
export type OriginT = "DB" | "ENTITY" | "UC" | "MIDDLEWARE" | "SERVICE";
/**
 * Context of a failure against an external service. Travels inside the
 * ServerError so the host's telemetry layer (e.g. a Sentry beforeSend) can
 * promote it to tags/extra when the error gets captured.
 */
export interface ServiceContextI {
    service: string;
    url?: string;
    baseURL?: string;
    method?: string;
    status?: number;
    statusText?: string;
    responseData?: unknown;
    responseHeaders?: unknown;
    code?: string;
}
export interface ServerErrorI {
    message?: string;
    extraInfo?: unknown;
    error?: unknown;
    type: ErrorT;
    origin: OriginT;
    serviceContext?: ServiceContextI;
    /** Original error (e.g. an AxiosError): error trackers show it chained to the issue. */
    cause?: unknown;
    /**
     * Override of the "status < 500 = expected" policy, for the 4xx that ARE a
     * monitoring signal: a 401 on a server-to-server route is a misaligned
     * secret, not a user typing a wrong password. `signal: true` makes the
     * error a signal without changing its HTTP status; `signal: false` forces
     * the opposite.
     */
    signal?: boolean;
}
/**
 * The single error class for handled failures across B.Health services.
 * Consumers with domain-specific vocabulary should subclass it (statics are
 * inherited) instead of forking it.
 */
export declare class ServerError extends Error {
    error: unknown;
    extraInfo: unknown;
    type: ErrorT;
    origin?: OriginT;
    serviceContext?: ServiceContextI;
    cause?: unknown;
    /** See ServerErrorI.signal — expected/signal policy override. */
    signal?: boolean;
    constructor({ message, type, extraInfo, error, origin, serviceContext, cause, signal }: ServerErrorI);
    /** HTTP status this error maps to, derived from STATUS_BY_TYPE. */
    get status(): number;
    isUnknown(): boolean;
    isSchema(): boolean;
    isUnauthorized(): boolean;
    isFromDB(): boolean;
    /**
     * Expected business error: the user got a 4xx and moved on. Not captured
     * by monitoring — the full policy lives in STATUS_BY_TYPE, except for the
     * explicit `signal` override (4xx machine-to-machine that ARE incidents).
     */
    isExpected(): boolean;
    hasMessage(): boolean;
    static isServerError(error: unknown): error is ServerError;
    /**
     * The single capture decision for a whole service: expected business
     * errors are not a monitoring signal; anything else (unexpected
     * ServerError, native Error, loose value) is.
     */
    static isSignal(error: unknown): boolean;
}
