/**
 * Minimal logger contract the library emits against. The host owns its
 * telemetry stack; this library never imports one. Any object with a
 * compatible `info` (e.g. the Logger from @b-health/telemetry) satisfies it.
 */
export interface HttpLoggerI {
    info(entry: {
        title: string;
        description: string;
    }): void;
}
/**
 * Inject the host's logger. Until this is called the library logs nothing.
 * Call it once at service bootstrap: `setHttpLogger(Logger)`.
 */
export declare const setHttpLogger: (hostLogger: HttpLoggerI | null) => void;
/** @internal */
export declare const getHttpLogger: () => HttpLoggerI | null;
