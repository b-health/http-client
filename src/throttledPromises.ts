async function asyncForEach<T>(
  array: T[],
  callback: (item: T, index: number, array: T[]) => Promise<void>
): Promise<void> {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function split<T>(arr: T[], n: number): T[][] {
  const res: T[][] = [];
  while (arr.length) {
    res.push(arr.splice(0, n));
  }
  return res;
}

const delayMS = (t: number = 200): Promise<number> => {
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
export const throttledPromises = async <T>(
  asyncFunction: (item: T) => Promise<any>,
  items: T[] = [],
  batchSize: number = 1,
  delay: number = 0
): Promise<any[]> => {
  return new Promise(async (resolve, reject) => {
    const output: any[] = [];
    // split() consumes its argument via splice — copy so the caller's array survives
    const batches = split([...items], batchSize);
    await asyncForEach(batches, async (batch: T[]) => {
      const promises = batch.map(asyncFunction).map((p) => p.catch(reject));
      const results = await Promise.all(promises);
      output.push(...results);
      await delayMS(delay);
    });
    resolve(output);
  });
};
