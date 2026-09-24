import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWithConcurrency } from "./mapPool";

test("mapWithConcurrency preserves order and caps in-flight work", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6];
  const result = await mapWithConcurrency(items, 2, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
    return item * 10;
  });
  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
});

test("mapWithConcurrency returns empty for no items", async () => {
  assert.deepEqual(await mapWithConcurrency([], 8, async (item) => item), []);
});
