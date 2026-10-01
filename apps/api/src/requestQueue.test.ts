import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestQueue } from "./requestQueue";

test("FIFO queue limits active work and releases slots after rejection", async () => {
  const queue = new RequestQueue(1);
  let release!: () => void;
  const order: number[] = [];
  const first = queue.run(async () => { order.push(1); await new Promise<void>(r => release = r); throw new Error("failed"); });
  const rejected = assert.rejects(first, /failed/);
  const second = queue.run(async () => { order.push(2); });
  const third = queue.run(async () => { order.push(3); });
  await Promise.resolve();
  assert.deepEqual(order, [1]);
  release();
  await Promise.all([rejected, second, third]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("queue bounds admission and removes expired waiters", async () => {
  const queue = new RequestQueue(1, 1, 10);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>(r => release = r));
  const expired = assert.rejects(queue.run(async () => assert.fail("expired work ran")), /wait timed out/);
  await assert.rejects(queue.run(async () => {}), /queue is full/);
  await expired;
  release();
  await first;
  await queue.run(async () => {});
});
