import assert from "node:assert/strict";
import { test } from "node:test";
import { overlapArea, placeLabels } from "./labelLayout";

const bounds = { width: 1000, height: 1000 };

test("placeLabels puts an isolated label to the right of its dot", () => {
  const [label] = placeLabels([{ x: 500, y: 500, w: 100, h: 20 }], bounds);
  assert.ok(label.box.x > 500);
  assert.ok(label.box.y < 500 && label.box.y + label.box.h > 500);
  assert.equal(label.leader, null);
});

test("placeLabels keeps neighbouring labels from overlapping", () => {
  const placed = placeLabels(
    [
      { x: 500, y: 500, w: 120, h: 20 },
      { x: 506, y: 504, w: 120, h: 20 },
      { x: 512, y: 508, w: 120, h: 20 },
      { x: 496, y: 512, w: 120, h: 20 },
    ],
    bounds,
  );
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.equal(overlapArea(placed[i].box, placed[j].box), 0, `labels ${i} and ${j} overlap`);
    }
  }
  assert.ok(placed.some((label) => label.leader), "crowded labels should fall back to leader lines");
});

test("placeLabels stays inside the canvas at the edges", () => {
  const [corner] = placeLabels([{ x: 995, y: 5, w: 150, h: 20 }], bounds);
  assert.ok(corner.box.x >= 0 && corner.box.x + corner.box.w <= bounds.width);
  assert.ok(corner.box.y >= 0 && corner.box.y + corner.box.h <= bounds.height);
});

test("placeLabels avoids caller-supplied obstacles", () => {
  const obstacle = { x: 505, y: 480, w: 200, h: 40 };
  const [label] = placeLabels([{ x: 500, y: 500, w: 100, h: 20 }], bounds, [obstacle]);
  assert.equal(overlapArea(label.box, obstacle), 0);
});
