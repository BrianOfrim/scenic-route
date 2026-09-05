import assert from "node:assert/strict";
import { test } from "node:test";
import { gridFor, planContactSheets, type GroundingLayer } from "./contactSheet";

function layer(role: string): GroundingLayer {
  return { role, legend: `${role} legend`, dataUrl: `data:${role}` };
}

test("gridFor covers common panel counts", () => {
  assert.deepEqual(gridFor(1), { cols: 1, rows: 1 });
  assert.deepEqual(gridFor(2), { cols: 2, rows: 1 });
  assert.deepEqual(gridFor(3), { cols: 2, rows: 2 });
  assert.deepEqual(gridFor(6), { cols: 3, rows: 2 });
});

test("planContactSheets keeps one image per slot when under the limit", () => {
  const sheets = planContactSheets([layer("schematic"), layer("terrain")], 3);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].role, "schematic");
  assert.equal(sheets[1].items.length, 1);
});

test("planContactSheets packs extras into at most maxRefs sheets", () => {
  const sheets = planContactSheets(
    [layer("schematic"), layer("terrain"), layer("streets"), layer("silhouette")],
    3,
  );
  assert.ok(sheets.length <= 3);
  assert.equal(sheets.reduce((sum, sheet) => sum + sheet.items.length, 0), 4);
  assert.ok(sheets.some((sheet) => sheet.items.length > 1));
  assert.match(sheets.find((sheet) => sheet.items.length > 1)!.role, /contact-sheet:/);
});
