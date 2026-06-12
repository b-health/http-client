/**
 * Run `asyncFunction` over `items` in sequential batches of `batchSize`,
 * waiting `delay` ms between batches. Rejects on the first item that throws.
 * The input array is not mutated.
 */
export declare const throttledPromises: <T>(asyncFunction: (item: T) => Promise<any>, items?: T[], batchSize?: number, delay?: number) => Promise<any[]>;
