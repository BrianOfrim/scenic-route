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

test("128 global slots and eight per owner allow other owners through a saturated user's backlog", async () => {
  const queue = new RequestQueue(128, Infinity, 240_000, 8);
  const releases: (() => void)[] = [];
  const active = new Map<string, number>();
  let total = 0;
  let peak = 0;
  const pending: Promise<void>[] = [];
  for (let user = 0; user < 17; user++) {
    const owner = `user-${user}`;
    for (let request = 0; request < 9; request++) pending.push(queue.run(async () => {
      active.set(owner, (active.get(owner) || 0) + 1);
      peak = Math.max(peak, ++total);
      assert.ok(total <= 128);
      assert.ok(active.get(owner)! <= 8);
      await new Promise<void>(resolve => releases.push(resolve));
      total--;
      active.set(owner, active.get(owner)! - 1);
    }, null, owner));
  }
  await Promise.resolve();
  assert.equal(total, 128);
  assert.equal(active.size, 16);
  while (releases.length) {
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(pending);
  assert.equal(peak, 128);
  assert.equal(active.size, 17);
  assert.equal(total, 0);
});

test("waiting owners take turns with FIFO order within each owner, including failures", async () => {
  const queue = new RequestQueue(1, 100, 240_000, 4);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => release = resolve), null, "busy");
  const order: string[] = [];
  const pending = ["a1", "a2", "a3", "b1", "b2", "c1"].map(id => {
    const result = queue.run(async () => { order.push(id); if (id === "b1") throw new Error("failed"); }, null, id[0]);
    return id === "b1" ? assert.rejects(result, /failed/) : result;
  });
  await Promise.resolve();
  release();
  await Promise.all([first, ...pending]);
  assert.deepEqual(order, ["a1", "b1", "c1", "a2", "b2", "a3"]);
});

test("nested provider calls reuse an owned slot and another owner cannot bypass it", async () => {
  const queue = new RequestQueue(1, 100, 240_000, 1);
  const order: string[] = [];
  let release!: () => void;
  const job = queue.run(async () => {
    await queue.run(async () => { order.push("provider"); }, undefined, "owner");
    await new Promise<void>(resolve => release = resolve);
    order.push("persisted");
  }, null, "owner");
  const direct = queue.run(async () => { order.push("direct"); }, undefined, "other");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["provider"]);
  release();
  await Promise.all([job, direct]);
  assert.deepEqual(order, ["provider", "persisted", "direct"]);
});

test("an owner blocked at its own limit times out without blocking another owner", async () => {
  const queue = new RequestQueue(2, 100, 10, 1);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => release = resolve), null, "a");
  const expired = assert.rejects(queue.run(async () => assert.fail("expired work ran"), undefined, "a"), /timed out/);
  await queue.run(async () => {}, undefined, "b");
  await expired;
  release();
  await first;
  await queue.run(async () => {}, undefined, "a");
});

test("expired direct waiters release the shared per-user waiting reservation", async () => {
  const queue = new RequestQueue(1, 100, 10, 1, 1);
  let release!: () => void;
  const active = queue.run(() => new Promise<void>(resolve => release = resolve), null, "owner");
  const expired = assert.rejects(queue.run(async () => assert.fail("expired work ran"), undefined, "owner"), /timed out/);
  assert.throws(() => queue.reserveWaiting("owner", 1), /at most 1 waiting/);
  await expired;
  const reservation = queue.reserveWaiting("owner", 1)[0];
  const replacement = queue.run(async () => {}, null, "owner", reservation);
  await Promise.resolve();
  release();
  await Promise.all([active, replacement]);
  assert.equal(reservation.pending, false);
});

test("global saturation admits more than 128 waiting image requests across users without a global backlog cap", async () => {
  const queue = new RequestQueue(128, Infinity, 240_000, 8, 8);
  const releases: (() => void)[] = [];
  let started = 0;
  const work = async () => { started++; await new Promise<void>(resolve => releases.push(resolve)); };
  const pending = Array.from({ length: 16 }, (_, owner) =>
    Array.from({ length: 8 }, () => queue.run(work, null, `active-${owner}`))).flat();
  await Promise.resolve();
  assert.equal(started, 128);
  for (let owner = 0; owner < 17; owner++) {
    for (let request = 0; request < 8; request++) pending.push(queue.run(work, undefined, `waiting-${owner}`));
  }
  await Promise.resolve();
  assert.equal(started, 128, "global saturation waits rather than exceeding 128 active requests");
  while (releases.length) {
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(pending);
  assert.equal(started, 264, "136 waiting requests were admitted across distinct owners");
});
