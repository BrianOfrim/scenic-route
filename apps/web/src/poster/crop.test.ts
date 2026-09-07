import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCrop, isClosedLoop, paddedBbox, schematicBbox, snapIndex, snapRadius } from "./crop";

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

test("schematicBbox is tighter than the map bbox and ignores distant landmarks", () => {
  const track: [number, number][] = [
    [53.0, -113.0],
    [53.01, -113.0],
    [53.01, -112.99],
    [53.0, -112.99],
  ];
  const wide = paddedBbox(track);
  const tight = schematicBbox(track);
  const wideSpan = wide[1][0] - wide[0][0];
  const tightSpan = tight[1][0] - tight[0][0];
  assert.ok(tightSpan < wideSpan);

  const withFarPin = schematicBbox(track, [{ lat: 54, lng: -112, distToRouteM: 80_000 }]);
  assert.deepEqual(withFarPin, tight);

  const withNearPin = schematicBbox(track, [{ lat: 53.014, lng: -112.995, distToRouteM: 400 }]);
  assert.ok(withNearPin[1][1] > tight[1][1]);
});

test("isClosedLoop treats nearby ends as one point", () => {
  const loop: [number, number][] = [
    [53.0, -113.0],
    [53.01, -113.0],
    [53.01, -112.99],
    [53.001, -113.0],
  ];
  assert.equal(isClosedLoop(loop), true);
  assert.equal(isClosedLoop([loop[0], [54, -112]]), false);
});
