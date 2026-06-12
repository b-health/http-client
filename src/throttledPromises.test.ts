import { throttledPromises } from "./throttledPromises";

describe("throttledPromises", () => {
  it("processes every item and preserves order", async () => {
    const results = await throttledPromises(async (n: number) => n * 2, [1, 2, 3, 4, 5], 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("never runs more than batchSize items concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await throttledPromises(
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      },
      [1, 2, 3, 4, 5, 6],
      2
    );
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("does not mutate the input array", async () => {
    const items = [1, 2, 3];
    await throttledPromises(async (n: number) => n, items, 2);
    expect(items).toEqual([1, 2, 3]);
  });

  it("rejects when an item fails", async () => {
    await expect(
      throttledPromises(
        async (n: number) => {
          if (n === 2) throw new Error("boom");
          return n;
        },
        [1, 2, 3],
        1
      )
    ).rejects.toThrow("boom");
  });

  it("returns [] for an empty list", async () => {
    await expect(throttledPromises(async (n: number) => n, [], 3)).resolves.toEqual([]);
  });
});
