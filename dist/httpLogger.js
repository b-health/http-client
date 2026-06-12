"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHttpLogger = exports.setHttpLogger = void 0;
let logger = null;
/**
 * Inject the host's logger. Until this is called the library logs nothing.
 * Call it once at service bootstrap: `setHttpLogger(Logger)`.
 */
const setHttpLogger = (hostLogger) => {
    logger = hostLogger;
};
exports.setHttpLogger = setHttpLogger;
/** @internal */
const getHttpLogger = () => logger;
exports.getHttpLogger = getHttpLogger;
