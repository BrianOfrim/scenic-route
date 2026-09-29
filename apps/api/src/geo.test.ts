import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearingWord,
  bboxDiagonal,
  bboxFromLatLng,
  findStopIndexes,
  haversineM,
  isLoop,
  nearestOnRoute,
  padBbox,
  padMeters,
  schematicXY,
  shouldTile,
  simplifyLatLng,
  remapRouteSpans,
  simplifyTrack,
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
  assert.equal(tileBboxes(small).length, 1);
  const tiles = tileBboxes(large);
  assert.ok(tiles.length > 4);
  for (const tile of tiles) assert.ok(bboxDiagonal(tile) <= 50_000);
  assert.equal(Math.min(...tiles.map((tile) => tile[0])), large[0]);
  assert.equal(Math.min(...tiles.map((tile) => tile[1])), large[1]);
  assert.equal(Math.max(...tiles.map((tile) => tile[2])), large[2]);
  assert.equal(Math.max(...tiles.map((tile) => tile[3])), large[3]);
});

test("a highway-scale box is cut into squares under the Overpass cap", () => {
  const dempster: [number, number, number, number] = [-138.86, 63.94, -133.13, 68.42];
  assert.ok(bboxDiagonal(dempster) > 500_000);
  const tiles = tileBboxes(dempster);
  assert.ok(tiles.length >= 80 && tiles.length <= 180);
  for (const tile of tiles) assert.ok(bboxDiagonal(tile) <= 50_000);
});

test("a bbox that cannot be tiled is empty", () => {
  assert.deepEqual(tileBboxes([Number.NaN, 0, 1, 1]), []);
  assert.deepEqual(tileBboxes([1, 1, 0, 2]), []);
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

function line(count: number, start: [number, number] = [53, -113]): [number, number][] {
  return Array.from({ length: count }, (_, i) => [start[0] + i * 0.0001, start[1]]);
}

test("findStopIndexes detects a recording gap", () => {
  const latlng = line(10);
  const time = [0, 1, 2, 3, 4, 124, 125, 126, 127, 128];
  const stops = findStopIndexes(latlng, time);
  assert.ok(stops.some((index) => index === 4 || index === 5));
});

test("findStopIndexes detects a low-speed dwell", () => {
  const moving1 = line(80);
  const parked = Array.from({ length: 70 }, () => moving1[79]);
  const moving2 = line(80, [moving1[79][0] + 0.0001, moving1[79][1]]);
  const latlng = [...moving1, ...parked, ...moving2];
  const time = latlng.map((_, i) => i);
  const velocity = [...Array(80).fill(5), ...Array(70).fill(0.1), ...Array(80).fill(5)];
  const stops = findStopIndexes(latlng, time, velocity);
  assert.equal(stops.length, 1);
  assert.ok(stops[0] >= 79 && stops[0] <= 150);
});

test("findStopIndexes merges nearby dwells into one snap point", () => {
  const moving1 = line(80);
  const cafe = moving1[79];
  const parked = Array.from({ length: 70 }, () => cafe);
  const fidget = Array.from({ length: 70 }, (_, i) => [cafe[0] + i * 0.00001, cafe[1]] as [number, number]);
  const moving2 = line(80, [cafe[0] + 0.0002, cafe[1]]);
  const latlng = [...moving1, ...parked, ...fidget, ...moving2];
  const time = latlng.map((_, i) => i);
  const velocity = [
    ...Array(80).fill(5),
    ...Array(70).fill(0.1),
    ...Array(70).fill(0.2),
    ...Array(80).fill(5),
  ];
  assert.equal(findStopIndexes(latlng, time, velocity).length, 1);
});

test("findStopIndexes ignores brief hesitations", () => {
  const latlng = line(20);
  const time = latlng.map((_, i) => i);
  const velocity = Array.from({ length: 20 }, (_, i) => (i === 10 || i === 11 ? 0 : 5));
  assert.deepEqual(findStopIndexes(latlng, time, velocity), []);
});

test("simplifyTrack keeps stop indexes", () => {
  const points = Array.from({ length: 5000 }, (_, i) => [53 + i / 10000, -113] as [number, number]);
  const { points: slim, kept } = simplifyTrack(points, 100, [2500]);
  assert.ok(slim.length >= 100);
  assert.deepEqual(slim[kept[0]], points[2500]);
});

test("remapRouteSpans maps full-stream indexes onto a simplified track", () => {
  const points = Array.from({ length: 5000 }, (_, i) => [53 + i / 10000, -113] as [number, number]);
  const { indexes } = simplifyTrack(points, 100);
  const remapped = remapRouteSpans([{ start: 2500, end: 2600 }], indexes);
  assert.ok(remapped && remapped.length === 1);
  assert.ok(remapped[0].start >= 0);
  assert.ok(remapped[0].end >= remapped[0].start);
  assert.ok(remapped[0].end < indexes.length);
  assert.ok(indexes[remapped[0].start] >= 2500);
  assert.ok(indexes[remapped[0].end] <= 2600);
  assert.equal(remapRouteSpans(undefined, indexes), undefined);
});

test("schematicXY maps corners to regions", () => {
  const bbox: [number, number, number, number] = [-114, 52, -112, 54];
  const nw = schematicXY(53.9, -113.9, bbox);
  assert.equal(nw.region, "upper-left");
  const se = schematicXY(52.1, -112.1, bbox);
  assert.equal(se.region, "lower-right");
});
