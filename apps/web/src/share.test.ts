import assert from "node:assert/strict";
import { test } from "node:test";
import { sharePoster } from "./share";

test("sharing sends the authorized image file, never a session-protected URL or error body", { timeout: 5000 }, async t => {
  const calls: ShareData[] = [];
  let canShare = true;
  let status = 200;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { share: async (data: ShareData) => { calls.push(data); }, canShare: () => canShare } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  t.mock.method(globalThis, "fetch", async () => new Response(status === 200 ? "private image" : "sign in required", { status, headers: { "content-type": "image/png" } }));
  assert.equal(await sharePoster("/api/posters/owned/image.png", "ride.png"), true);
  assert.equal(calls.length, 1);
  assert.equal(await calls[0].files![0].text(), "private image");
  assert.equal(calls[0].url, undefined);
  canShare = false;
  assert.equal(await sharePoster("/api/posters/owned/image.png", "ride.png"), false);
  canShare = true;
  for (const code of [401, 403, 404]) {
    status = code;
    assert.equal(await sharePoster("/api/posters/guessed/image.png", "ride.png"), false);
  }
  assert.equal(calls.length, 1);
});
