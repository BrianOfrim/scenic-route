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

test("shared requests publish progress to every subscriber, including a StrictMode remount", async () => {
  let publish!: (value: number) => void;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  const load = shareRecentRequests(1_000, async (_key: string, progress: (value: number) => void) => {
    calls += 1;
    publish = progress;
    await gate;
    return 3;
  });
  const firstProgress: number[] = [];
  const secondProgress: number[] = [];
  const first = load("gallery", value => firstProgress.push(value));
  await Promise.resolve();
  publish(1);
  const second = load("gallery", value => secondProgress.push(value));
  publish(2);
  assert.equal(first, second);
  assert.deepEqual(firstProgress, [1, 2]);
  assert.deepEqual(secondProgress, [1, 2]);
  finish();
  assert.equal(await second, 3);
  assert.equal(calls, 1);
});
