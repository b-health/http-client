/**
 * Error classification vocabulary. Each type maps to exactly one HTTP status
 * (see STATUS_BY_TYPE) — the capture policy derives from that mapping.
 */
export type ErrorT =
  | "UNKNOWN"
  | "RULE"
  | "SCHEMA"
  | "NOT-FOUND"
  | "API"
  | "UNAUTHORIZED"
  | "INVALID-TYPE";

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

// Single source of truth type → HTTP status. The capture policy derives from
// here: 4xx = expected user behavior (not a monitoring signal), 5xx = real
// failure. SCHEMA is 400 and not 403: admin clients interpret 403 as an auth
// failure and trigger a credentials refresh. INVALID-TYPE (contract
// violation, e.g. a malformed queue event) and API (external service failure)
// are bugs/incidents, not user errors: 5xx.
const STATUS_BY_TYPE: Record<ErrorT, number> = {
  RULE: 400,
  SCHEMA: 400,
  UNAUTHORIZED: 401,
  "NOT-FOUND": 404,
  "INVALID-TYPE": 500,
  API: 500,
  UNKNOWN: 500,
};

export interface ServerErrorI {
  message?: string;
  extraInfo?: unknown;
  error?: unknown;
  type: ErrorT;
  origin: OriginT;
  serviceContext?: ServiceContextI;
  /** Original error (e.g. an AxiosError): error trackers show it chained to the issue. */
  cause?: unknown;
}

/**
 * The single error class for handled failures across B.Health services.
 * Consumers with domain-specific vocabulary should subclass it (statics are
 * inherited) instead of forking it.
 */
export class ServerError extends Error {
  error: unknown;
  extraInfo: unknown;
  type: ErrorT;
  origin?: OriginT;
  serviceContext?: ServiceContextI;
  // The original error also as cause: Sentry (linkedErrors) shows it chained
  // with its stack — without this, issues group by the ServerError
  // construction site and lose the root cause.
  cause?: unknown;

  constructor({ message, type, extraInfo, error, origin, serviceContext, cause }: ServerErrorI) {
    super(message);
    this.extraInfo = extraInfo;
    this.error = error;
    this.type = type;
    this.origin = origin || "ENTITY";
    this.serviceContext = serviceContext;
    const chained = cause ?? error;
    if (chained !== undefined) this.cause = chained;

    Error.captureStackTrace(this, this.constructor);
  }

  /** HTTP status this error maps to, derived from STATUS_BY_TYPE. */
  get status(): number {
    return STATUS_BY_TYPE[this.type] ?? 500;
  }

  isUnknown(): boolean {
    return this.type === "UNKNOWN";
  }

  isSchema(): boolean {
    return this.type === "SCHEMA";
  }

  isUnauthorized(): boolean {
    return this.type === "UNAUTHORIZED";
  }

  isFromDB(): boolean {
    return this.origin === "DB";
  }

  /**
   * Expected business error: the user got a 4xx and moved on. Not captured
   * by monitoring — the full policy lives in STATUS_BY_TYPE.
   */
  isExpected(): boolean {
    return this.status < 500;
  }

  hasMessage(): boolean {
    return Boolean(this.message);
  }

  public static isServerError(error: unknown): error is ServerError {
    return error instanceof ServerError;
  }

  /**
   * The single capture decision for a whole service: expected business
   * errors are not a monitoring signal; anything else (unexpected
   * ServerError, native Error, loose value) is.
   */
  public static isSignal(error: unknown): boolean {
    return !(ServerError.isServerError(error) && error.isExpected());
  }
}
