import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCrop, snapIndex, snapRadius } from "./crop";

test("snapIndex pulls nearby values onto a stop", () => {
  assert.equal(snapIndex(48, [10, 50, 90], 4), 50);
  assert.equal(snapIndex(40, [10, 50, 90], 4), 40);
  assert.equal(snapIndex(10, [], 4), 10);
});

test("snapRadius stays in a usable band", () => {
  assert.ok(snapRadius(80) >= 4);
  assert.ok(snapRadius(2000) <= 16);
});

test("clampCrop keeps a usable slice", () => {
  assert.deepEqual(clampCrop(100, 20, 80), [20, 80]);
  assert.deepEqual(clampCrop(100, 90, 20), [90, 91]);
});
