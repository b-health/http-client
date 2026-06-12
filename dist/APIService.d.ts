import { AxiosError } from "axios";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { ServerError } from "./ServerError";
/** Options for a single outgoing request. A fresh axios instance is created per call. */
export interface RequestOptions {
    url: string;
    body?: any;
    params?: any;
    query?: any;
    headers?: any;
    baseURL: string;
    timeout?: number;
    /** Sent as `Authorization: Bearer <token>`. */
    token?: string;
    httpAgent?: HttpAgent;
    httpsAgent?: HttpsAgent;
    maxBodyLength?: number;
}
export declare const APIService: {
    get: <T>(options: RequestOptions) => Promise<T>;
    post: <T>(options: RequestOptions, log?: boolean) => Promise<T>;
    put: <T>(options: RequestOptions) => Promise<T>;
    patch: <T>(options: RequestOptions) => Promise<T>;
    delete: <T = void>(options: RequestOptions) => Promise<T>;
    handleError: (error: AxiosError | null | undefined, service?: string) => ServerError;
    throttledPromises: <T>(asyncFunction: (item: T) => Promise<any>, items?: T[], batchSize?: number, delay?: number) => Promise<any[]>;
};
/** Contract for HIS-plugin style POST functions: typed in, typed out. */
export type PluginPostI<In, Out> = ({ data }: {
    data: In;
}) => Promise<Out>;
