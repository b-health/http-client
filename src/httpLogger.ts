/**
 * Minimal logger contract the library emits against. The host owns its
 * telemetry stack; this library never imports one. Any object with a
 * compatible `info` (e.g. the Logger from @b-health/telemetry) satisfies it.
 */
export interface HttpLoggerI {
  info(entry: { title: string; description: string }): void;
}

let logger: HttpLoggerI | null = null;

/**
 * Inject the host's logger. Until this is called the library logs nothing.
 * Call it once at service bootstrap: `setHttpLogger(Logger)`.
 */
export const setHttpLogger = (hostLogger: HttpLoggerI | null): void => {
  logger = hostLogger;
};

/** @internal */
export const getHttpLogger = (): HttpLoggerI | null => logger;
