import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { performance } from "perf_hooks";
import { ServerError } from "./ServerError";
import { getHttpLogger } from "./httpLogger";
import { throttledPromises } from "./throttledPromises";

const MAX_SERIALIZED_BYTES = 4096;

// Deep-copy for safe transport, capping size: upstream error pages can be
// multi-MB HTML, serialized several times per error — without a cap the
// error path becomes the process's memory hotspot exactly during an outage.
const safeSerialize = (value: unknown, maxBytes: number = MAX_SERIALIZED_BYTES): unknown => {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    if (json.length <= maxBytes) return JSON.parse(json);
    return { truncated: true, preview: json.slice(0, maxBytes) };
  } catch {
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

const pickSafeHeaders = (headers: unknown): Record<string, string> | undefined => {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) out[key] = String(value);
  }
  return out;
};

// The raw AxiosError carries config.headers (Authorization: Bearer ...) and
// config.data (request body — PHI in this platform). It must never leave the
// library: chain a synthetic error that keeps the diagnostic value (message,
// stack, code, name) and nothing else.
const sanitizedCause = (error: AxiosError): Error => {
  const cause = new Error(error.message);
  cause.name = error.name;
  if (error.stack) cause.stack = error.stack;
  (cause as Error & { code?: string }).code = error.code;
  return cause;
};

/** Upstream detail embedded in the (user-visible) message is capped at this length. */
const MAX_MESSAGE_DETAIL = 300;

/** Applied when RequestOptions.timeout is omitted. Pass 0 to disable the timeout. */
const DEFAULT_TIMEOUT_MS = 1000;

/** Options for a single outgoing request. A fresh axios instance is created per call. */
export interface RequestOptions {
  url: string;
  body?: any;
  /** URL query string parameters. */
  query?: any;
  headers?: any;
  baseURL: string;
  /** Milliseconds. Defaults to 1000. Pass 0 to disable (axios semantics). */
  timeout?: number;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Skip the per-request benchmark log (e.g. high-frequency polling calls). */
  silent?: boolean;
  httpAgent?: HttpAgent;
  httpsAgent?: HttpsAgent;
  /** Max outgoing request body size in bytes (axios default: unlimited). */
  maxBodyLength?: number;
  /** Max response body size in bytes (axios default: unlimited). */
  maxContentLength?: number;
}

const createInstance = (options: RequestOptions): AxiosInstance => {
  return axios.create({
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

const logBenchmark = (method: string, url: string, startTime: number, endTime: number) => {
  // Telemetry must never sit on the data path: a throwing host logger would
  // turn an already-successful request (the POST happened) into a failure.
  try {
    const duration = endTime - startTime;
    getHttpLogger()?.info({
      title: "APISERVICE TIME:",
      description: `[${method}] ${url} took ${duration.toFixed(2)}ms`,
    });
  } catch {
    // swallow: losing one breadcrumb beats failing a succeeded request
  }
};

type MethodT = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const request = async <T>(method: MethodT, options: RequestOptions): Promise<T> => {
  const startTime = performance.now();
  const axiosInstance = createInstance(options);
  const config = { params: options.query };

  let response: AxiosResponse<T>;
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

  if (!options.silent) logBenchmark(method, options.url, startTime, performance.now());
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
const handleError = (error: unknown, service?: string): ServerError => {
  if (!error) {
    return new ServerError({
      message: "Unknown error occurred",
      type: "UNKNOWN",
      origin: "SERVICE",
      error: null,
    });
  }

  // Already classified upstream — re-wrapping would destroy its type.
  if (ServerError.isServerError(error)) return error;

  // Not an axios failure: a defect in our own code reached this catch.
  // Classifying it as API would blame the external service for our bug.
  if (!axios.isAxiosError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    return new ServerError({
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
    const responseData = error.response.data as { message?: string } | string | undefined;
    let message = service ? `Error from ${service}` : "Error from API";
    if (responseData) {
      // responseData may be a string OR an object — and its `message` field may
      // itself be an object. Anything non-string interpolated via template
      // literal yields "[object Object]", which hides the real cause:
      // serialize explicitly so the message stays informative.
      const upstreamMessage = (responseData as { message?: unknown }).message;
      const detail =
        typeof responseData === "string"
          ? responseData
          : typeof upstreamMessage === "string" && upstreamMessage
            ? upstreamMessage
            : JSON.stringify(safeSerialize(responseData));
      // message is user-visible for RULE/API types: cap upstream detail so a
      // whole error page never reaches the client response.
      const capped = detail.length > MAX_MESSAGE_DETAIL ? `${detail.slice(0, MAX_MESSAGE_DETAIL)}…` : detail;
      message = `${message} - "${capped}"`;
    }

    return new ServerError({
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

  return new ServerError({
    message: error.message || "Unknown error occurred",
    type: "API",
    origin: "SERVICE",
    cause: sanitizedCause(error),
    serviceContext: baseContext,
  });
};

export const APIService = {
  get: <T>(options: RequestOptions): Promise<T> => request<T>("GET", options),
  post: <T>(options: RequestOptions): Promise<T> => request<T>("POST", options),
  put: <T>(options: RequestOptions): Promise<T> => request<T>("PUT", options),
  patch: <T>(options: RequestOptions): Promise<T> => request<T>("PATCH", options),
  delete: <T = void>(options: RequestOptions): Promise<T> => request<T>("DELETE", options),
  handleError,
  throttledPromises,
};

/** Contract for HIS-plugin style POST functions: typed in, typed out. */
export type PluginPostI<In, Out> = ({ data }: { data: In }) => Promise<Out>;
