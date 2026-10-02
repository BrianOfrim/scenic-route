import assert from "node:assert/strict";
import { test } from "node:test";
import { createReferenceUploadCache } from "./referenceUploadCache";

test("plans and generation share concurrent uploads, but changed references upload again", async () => {
  let calls = 0;
  const cache = createReferenceUploadCache(async () => ({ referenceBatchId: String(++calls), expiresAt: Date.now() + 10000 }));
  const results = await Promise.all([cache(["route", "satellite"]), cache(["route", "satellite"])]);
  assert.equal(results[0].referenceBatchId, results[1].referenceBatchId);
  await cache(["route", "satellite"]);
  assert.equal(calls, 1);
  await cache(["changed", "satellite"]);
  assert.equal(calls, 2);
});

test("failed and expired uploads can be retried", async () => {
  let calls = 0;
  const cache = createReferenceUploadCache(async () => {
    if (++calls === 1) throw new Error("offline");
    return { referenceBatchId: String(calls), expiresAt: 0 };
  });
  await assert.rejects(cache(["route"]), /offline/);
  await cache(["route"]);
  await cache(["route"]);
  assert.equal(calls, 3);
});
