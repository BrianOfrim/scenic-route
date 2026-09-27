import assert from "node:assert/strict";
import { test } from "node:test";
import { shareRecentRequests } from "./inFlight";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("recent identical calls share one promise", async () => {
  let calls = 0;
  const load = shareRecentRequests(50, async (key: string) => {
    calls += 1;
    await delay(10);
    return key;
  });
  const first = load("posters");
  const second = load("posters");
  assert.equal(second, first);
  assert.equal(await first, "posters");
  assert.equal(calls, 1);
});

test("a settled call is not reused", async () => {
  let calls = 0;
  const load = shareRecentRequests(1_000, async () => {
    calls += 1;
    return calls;
  });
  assert.equal(await load("posters"), 1);
  assert.equal(await load("posters"), 2);
});

test("an older in-flight call is not joined after the window", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const load = shareRecentRequests(20, async () => {
    calls += 1;
    const n = calls;
    await gate;
    return n;
  });
  const first = load("posters");
  await delay(30);
  const second = load("posters");
  assert.notEqual(second, first);
  release();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
});
