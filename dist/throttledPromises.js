"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throttledPromises = void 0;
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}
function split(arr, n) {
    const res = [];
    while (arr.length) {
        res.push(arr.splice(0, n));
    }
    return res;
}
const delayMS = (t) => {
    return new Promise((resolve) => {
        setTimeout(resolve, t);
    });
};
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
const throttledPromises = async (asyncFunction, items = [], batchSize = 1, delay = 0) => {
    return new Promise(async (resolve, reject) => {
        const output = [];
        // split() consumes its argument via splice — copy so the caller's array survives
        const batches = split([...items], batchSize);
        await asyncForEach(batches, async (batch) => {
            const promises = batch.map(asyncFunction).map((p) => p.catch(reject));
            const results = await Promise.all(promises);
            output.push(...results);
            await delayMS(delay);
        });
        resolve(output);
    });
};
exports.throttledPromises = throttledPromises;
