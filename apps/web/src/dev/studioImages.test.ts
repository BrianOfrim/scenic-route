import test from "node:test";
import assert from "node:assert/strict";
import { createImageQueue, studioImage } from "./studioImages";

test("thumbnail queue bounds parallel downloads and continues after a failure", async () => {
  const queue = createImageQueue(2);
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => queue(async () => {
    active++; maximum = Math.max(active, maximum);
    if (active === 2) release();
    await gate;
    active--;
    if (!index) throw new Error("failure");
    return index;
  })));
  assert.equal(maximum, 2);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 5);
});

test("preview downloads share a request, remain account scoped, and allow retry after errors", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options?.credentials, "include");
    if (calls === 1) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
    return new Response("image", { headers: { "content-type": "image/png" } });
  };
  try {
    await assert.rejects(studioImage("user-a", "/preview-test", true), /Unavailable/);
    const [a, b] = await Promise.all([studioImage("user-a", "/preview-test", true), studioImage("user-a", "/preview-test", true)]);
    assert.equal(a, b);
    assert.equal(calls, 2);
    const other = await studioImage("user-b", "/preview-test", true);
    assert.notEqual(a, other);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
