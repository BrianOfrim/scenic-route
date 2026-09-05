import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearingWord,
  bboxDiagonal,
  bboxFromLatLng,
  haversineM,
  isLoop,
  nearestOnRoute,
  padBbox,
  padMeters,
  schematicXY,
  shouldTile,
  simplifyLatLng,
  tileBboxes,
} from "./geo";

test("haversine is roughly 111 km per degree of latitude", () => {
  const d = haversineM([53, -113], [54, -113]);
  assert.ok(d > 110_000 && d < 112_500);
});

test("padBbox expands in all directions", () => {
  const padded = padBbox([-113.1, 53.0, -113.0, 53.1], 1000);
  assert.ok(padded[0] < -113.1);
  assert.ok(padded[1] < 53.0);
  assert.ok(padded[2] > -113.0);
  assert.ok(padded[3] > 53.1);
});

test("padMeters clamps to 400–5000", () => {
  assert.equal(padMeters(100), 400);
  assert.equal(padMeters(1_000_000), 5000);
  assert.equal(padMeters(10_000), 1500);
});

test("shouldTile when diagonal exceeds 50 km", () => {
  const small = bboxFromLatLng([
    [53.0, -113.0],
    [53.02, -112.98],
  ]);
  const large = bboxFromLatLng([
    [50, -120],
    [54, -110],
  ]);
  assert.equal(shouldTile(small), false);
  assert.equal(shouldTile(large), true);
  assert.equal(tileBboxes(large).length, 4);
  assert.ok(bboxDiagonal(large) > 50_000);
});

test("isLoop detects a closed ride", () => {
  const loop: [number, number][] = [
    [53, -113],
    [53.01, -113],
    [53.01, -112.99],
    [53.0005, -113.0003],
  ];
  assert.equal(isLoop(loop, 2000), true);
  assert.equal(isLoop([loop[0], [54, -112]], 2000), false);
});

test("bearingWord and nearestOnRoute", () => {
  const track: [number, number][] = [
    [53, -113],
    [53.01, -113],
    [53.02, -113],
  ];
  assert.equal(bearingWord([53.01, -113], [53.05, -113]), "north");
  const near = nearestOnRoute(53.01, -113, track);
  assert.ok(near.distM < 5);
  assert.ok(near.routeFrac > 0.4 && near.routeFrac < 0.6);
});

test("simplifyLatLng keeps endpoints", () => {
  const points = Array.from({ length: 5000 }, (_, i) => [53 + i / 10000, -113] as [number, number]);
  const slim = simplifyLatLng(points, 100);
  assert.equal(slim.length, 100);
  assert.deepEqual(slim[0], points[0]);
  assert.deepEqual(slim[99], points[4999]);
});

test("schematicXY maps corners to regions", () => {
  const bbox: [number, number, number, number] = [-114, 52, -112, 54];
  const nw = schematicXY(53.9, -113.9, bbox);
  assert.equal(nw.region, "upper-left");
  const se = schematicXY(52.1, -112.1, bbox);
  assert.equal(se.region, "lower-right");
});
