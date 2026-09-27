import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasBitmapCollapsed } from "./mapCanvas";

test("a visible map with a 1px buffer needs its canvas limit reset", () => {
  assert.equal(canvasBitmapCollapsed(808, 872, 0, 1), true);
  assert.equal(canvasBitmapCollapsed(284, 872, 1, 1), true);
});

test("a normal bitmap and a hidden container are left alone", () => {
  assert.equal(canvasBitmapCollapsed(808, 872, 1616, 1744), false);
  assert.equal(canvasBitmapCollapsed(0, 0, 0, 0), false);
});
