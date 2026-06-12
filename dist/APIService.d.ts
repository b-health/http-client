import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { ServerError } from "./ServerError";
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
export declare const APIService: {
    get: <T>(options: RequestOptions) => Promise<T>;
    post: <T>(options: RequestOptions) => Promise<T>;
    put: <T>(options: RequestOptions) => Promise<T>;
    patch: <T>(options: RequestOptions) => Promise<T>;
    delete: <T = void>(options: RequestOptions) => Promise<T>;
    handleError: (error: unknown, service?: string) => ServerError;
    throttledPromises: <T, R = any>(asyncFunction: (item: T) => Promise<R>, items?: T[], batchSize?: number, delay?: number) => Promise<R[]>;
};
/** Contract for HIS-plugin style POST functions: typed in, typed out. */
export type PluginPostI<In, Out> = ({ data }: {
    data: In;
}) => Promise<Out>;
