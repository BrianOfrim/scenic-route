import assert from "node:assert/strict";
import test from "node:test";
import {
  appendOutlinePoint,
  emptyOutline,
  redoOutline,
  removeOutlinePoint,
  undoOutline,
} from "./polygonEdit";

test("outline edits undo and redo through adds, moves, and removals", () => {
  let outline = emptyOutline();
  outline = appendOutlinePoint(outline, [1, 2]);
  outline = appendOutlinePoint(outline, [3, 4]);
  outline = appendOutlinePoint(outline, [5, 6]);
  assert.equal(outline.selected, 2);
  outline = removeOutlinePoint(outline, 1);
  assert.deepEqual(outline.points, [[1, 2], [5, 6]]);
  outline = undoOutline(outline);
  assert.deepEqual(outline.points, [[1, 2], [3, 4], [5, 6]]);
  outline = undoOutline(outline);
  assert.deepEqual(outline.points, [[1, 2], [3, 4]]);
  outline = redoOutline(outline);
  assert.equal(outline.points.length, 3);
  outline = undoOutline(undoOutline(undoOutline(undoOutline(outline))));
  assert.deepEqual(outline.points, []);
  assert.equal(redoOutline(outline).points.length, 1);
});
