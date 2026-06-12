import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { performance } from "perf_hooks";
import { ServerError } from "./ServerError";
import { getHttpLogger } from "./httpLogger";
import { throttledPromises } from "./throttledPromises";

const safeSerialize = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { unserializable: true };
  }
};

/** Options for a single outgoing request. A fresh axios instance is created per call. */
export interface RequestOptions {
  url: string;
  body?: any;
  /** URL query string parameters. */
  query?: any;
  headers?: any;
  baseURL: string;
  timeout?: number;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Skip the per-request benchmark log (e.g. high-frequency polling calls). */
  silent?: boolean;
  httpAgent?: HttpAgent;
  httpsAgent?: HttpsAgent;
  maxBodyLength?: number;
}

const createInstance = (options: RequestOptions): AxiosInstance => {
  return axios.create({
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

const logBenchmark = (method: string, url: string, startTime: number, endTime: number) => {
  const duration = endTime - startTime;
  getHttpLogger()?.info({
    title: "APISERVICE TIME:",
    description: `[${method}] ${url} took ${duration.toFixed(2)}ms`,
  });
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
 * Translate an AxiosError into a classified ServerError.
 *
 * 4xx upstream = business answer from the external service (RULE — not a
 * monitoring signal). 5xx or no response (timeout, DNS, refused connection) =
 * external service failure (API — a signal, and distinguishable from our own
 * bugs which stay UNKNOWN), carrying the request context the monitoring
 * boundary would not have otherwise, with the original AxiosError chained
 * via `cause`. `code` (e.g. ECONNABORTED, ERR_BAD_RESPONSE) always travels
 * in serviceContext: type says WHO failed, code says HOW.
 */
const handleError = (error: AxiosError | null | undefined, service?: string): ServerError => {
  if (!error) {
    return new ServerError({
      message: "Unknown error occurred",
      type: "UNKNOWN",
      origin: "SERVICE",
      error: null,
    });
  }

  if (error.response) {
    const responseData = error.response.data as { message?: string } | string | undefined;
    let message = service ? `Error from ${service}` : "Error from API";
    if (responseData) {
      // responseData may be a string OR an object. Stringifying an object via
      // template literals yields "[object Object]", which hides the real
      // cause — serialize it explicitly so the message stays informative.
      const detail =
        typeof responseData === "string"
          ? responseData
          : (responseData as { message?: string }).message || JSON.stringify(safeSerialize(responseData));
      message = `${message} - "${detail}"`;
    }

    return new ServerError({
      message,
      type: error.response.status >= 400 && error.response.status < 500 ? "RULE" : "API",
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
        code: error.code,
      },
    });
  }

  return new ServerError({
    message: error.message || "Unknown error occurred",
    type: "API",
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
