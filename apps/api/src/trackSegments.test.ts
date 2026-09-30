import assert from "node:assert/strict";
import { test } from "node:test";
import { remapTrackBreaks, stitchTrackSegments, trackDistanceWithBreaks } from "./trackSegments";

const point = (lat: number, lng: number, time: Date | null = null) => ({ lat, lng, time });

test("untimed segments are reversed and reordered only when endpoints meet", () => {
  const segments = [
    [point(0, 0), point(0, .001)],
    [point(0, .003), point(0, .002)],
    [point(0, .1), point(0, .101)],
    [point(0, .002), point(0, .001)],
  ];
  const result = stitchTrackSegments(segments);
  assert.deepEqual(result.points.map((p) => p.lng), [0, .001, .001, .002, .002, .003, .1, .101]);
  assert.deepEqual(result.breaks, [6]);
  const coords = result.points.map((p) => [p.lat, p.lng] as [number, number]);
  assert.ok(trackDistanceWithBreaks(coords, result.breaks) < 500);
  assert.deepEqual(remapTrackBreaks(result.breaks, [0, 2, 4, 5, 6, 7]), [4]);
});

test("timed segments retain recording order and leave distant gaps disconnected", () => {
  const result = stitchTrackSegments([
    [point(0, 0, new Date(0)), point(0, .001, new Date(1000))],
    [point(0, .1, new Date(2000)), point(0, .101, new Date(3000))],
  ]);
  assert.deepEqual(result.breaks, [2]);
  assert.deepEqual(result.points.map((p) => p.lng), [0, .001, .1, .101]);
});

test("an untimed track can begin with a middle segment in the file", () => {
  const result = stitchTrackSegments([
    [point(0, .001), point(0, .002)],
    [point(0, .002), point(0, .003)],
    [point(0, 0), point(0, .001)],
  ]);
  assert.deepEqual(result.breaks, []);
  const coords = result.points.map((p) => [p.lat, p.lng] as [number, number]);
  assert.ok(trackDistanceWithBreaks(coords, result.breaks) < 500);
  assert.deepEqual(result.points.map((p) => p.lng).sort((a, b) => a - b), [0, .001, .001, .002, .002, .003]);
});
