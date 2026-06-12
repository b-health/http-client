/**
 * Run `asyncFunction` over `items` in sequential batches of `batchSize`,
 * waiting `delay` ms between batches. The input array is not mutated.
 *
 * Failure contract — read before relying on rejection semantics:
 * - The returned promise rejects on the FIRST item that rejects, BUT the
 *   remaining batches still run to completion in the background: side
 *   effects (sends, writes) keep firing after the caller saw the rejection.
 *   Do NOT retry the whole list from a catch block — you would duplicate
 *   the items that are still in flight.
 * - Items that rejected leave `undefined` holes in the result array.
 * - `batchSize` must be >= 1 — 0 or negative loops forever.
 * - `asyncFunction` must return a Promise; a synchronously-throwing callback
 *   leaves the returned promise unsettled (the caller hangs).
 */
export declare const throttledPromises: <T, R = any>(asyncFunction: (item: T) => Promise<R>, items?: T[], batchSize?: number, delay?: number) => Promise<R[]>;
