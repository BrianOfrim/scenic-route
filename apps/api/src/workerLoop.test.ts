import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerLoop } from "./workerLoop";

function harness(tick: () => Promise<boolean>) {
    let callback: (() => void) | undefined;
    let delay: number | undefined;
    const errors: unknown[] = [];
    const loop = createWorkerLoop(tick, {
        idleMs: 30 * 60_000, onError: error => errors.push(error),
        schedule: (cb, ms) => { callback = cb; delay = ms; return 1 as any; },
        cancel: () => { callback = undefined; delay = undefined; },
    });
    return { loop, errors, delay: () => delay, async fire() {
        const cb = callback; callback = undefined; delay = undefined;
        assert.ok(cb); cb();
        await new Promise<void>(resolve => setImmediate(resolve));
    } };
}
test("idle checks sleep for thirty minutes, while unfinished work checks every second", async () => {
    let active = false;
    let ticks = 0;
    const h = harness(async () => { ticks++; return active; });
    h.loop.wake();
    assert.equal(h.delay(), 0);
    await h.fire();
    assert.equal(h.delay(), 30 * 60_000);
    active = true;
    h.loop.wake();
    assert.equal(h.delay(), 0);
    await h.fire();
    assert.equal(h.delay(), 1000);
    active = false;
    await h.fire();
    assert.equal(h.delay(), 30 * 60_000);
    assert.equal(ticks, 3);
    await h.loop.stop();
    assert.equal(h.delay(), undefined);
});
test("a wakeup during the final idle check cannot be lost or start an overlapping tick", async () => {
    let finish!: (active: boolean) => void;
    let ticks = 0;
    const h = harness(() => { ticks++; return new Promise<boolean>(resolve => { finish = resolve; }); });
    h.loop.wake();
    await h.fire();
    h.loop.wake(); h.loop.wake();
    assert.equal(ticks, 1);
    finish(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.delay(), 0);
    await h.fire();
    assert.equal(ticks, 2);
    const stopped = h.loop.stop();
    finish(true);
    await stopped;
    assert.equal(h.delay(), undefined);
    h.loop.wake();
    assert.equal(h.delay(), undefined);
});
test("database errors back off rather than keeping an exhausted Neon project busy", async () => {
    const h = harness(async () => { throw new Error("quota exceeded"); });
    h.loop.wake();
    await h.fire();
    assert.equal(h.errors.length, 1);
    assert.equal(h.delay(), 30 * 60_000);
    h.loop.wake();
    assert.equal(h.delay(), 0);
    await h.loop.stop();
});
