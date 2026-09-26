import assert from "node:assert/strict";
import { test } from "node:test";
import { coalesceRequests } from "../inFlight";
import { contextFeatureQuery, DEFAULT_FEATURE_IDS } from "./featureCatalog";

test("geography visibility and selection order do not change the context request", () => {
  const baseline = contextFeatureQuery(DEFAULT_FEATURE_IDS, {});
  assert.equal(contextFeatureQuery([], {}), baseline);
  for (const id of DEFAULT_FEATURE_IDS) {
    assert.equal(contextFeatureQuery(DEFAULT_FEATURE_IDS.filter((item) => item !== id), {}), baseline);
  }
  assert.equal(contextFeatureQuery([...DEFAULT_FEATURE_IDS].reverse(), {}), baseline);
  assert.equal(contextFeatureQuery([], { peaks: 500 }), baseline);
  assert.notEqual(contextFeatureQuery(["peaks"], {}), baseline);
  assert.notEqual(contextFeatureQuery(["peaks"], { peaks: 500 }), contextFeatureQuery(["peaks"], { peaks: 100 }));
  assert.notEqual(contextFeatureQuery(["cemeteries"], {}), baseline);
});

test("pending context requests are shared, but settled contexts are not cached", async () => {
  let calls = 0;
  const load = coalesceRequests(async (key) => { calls++; return key; });
  const a = load("activity-a");
  assert.equal(load("activity-a"), a);
  assert.notEqual(load("activity-b"), a);
  await a;
  assert.equal(calls, 2);
  await load("activity-a");
  assert.equal(calls, 3);
});

test("failed requests do not prevent later attempts", async () => {
  let fail = true;
  const load = coalesceRequests(async () => {
    if (fail) throw new Error("offline");
    return "ok";
  });
  const first = load("activity");
  assert.equal(load("activity"), first);
  await assert.rejects(first, /offline/);
  fail = false;
  assert.equal(await load("activity"), "ok");
});
