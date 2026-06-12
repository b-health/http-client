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
const delayMS = (t = 200) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(t);
        }, t);
    });
};
/**
 * Run `asyncFunction` over `items` in sequential batches of `batchSize`,
 * waiting `delay` ms between batches. Rejects on the first item that throws.
 * The input array is not mutated.
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
