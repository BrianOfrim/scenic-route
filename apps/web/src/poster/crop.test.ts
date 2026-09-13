import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCrop, distToTrackM, isClosedLoop, isNearCroppedRoute, paddedBbox, schematicBbox, shiftRouteSpans, snapIndex, snapRadius } from "./crop";

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

test("isNearCroppedRoute drops landmarks the cropped track no longer passes", () => {
  const full: [number, number][] = [
    [53.0, -113.0],
    [53.01, -113.0],
    [53.02, -113.0],
  ];
  const landmark = { lat: 53.0, lng: -113.0 };
  assert.equal(isNearCroppedRoute(landmark, full), true);
  assert.equal(isNearCroppedRoute(landmark, full.slice(2)), false);
  assert.ok(distToTrackM([53.0, -113.0], full.slice(2)) > 100);
});

test("isNearCroppedRoute keeps beaches out to 500 m and towns out to 1 km", () => {
  const track: [number, number][] = [
    [53.0, -113.0],
    [53.005, -113.0],
    [53.01, -113.0],
  ];
  const beach = { lat: 53.005, lng: -112.994, kind: "beach" };
  const farBeach = { lat: 53.005, lng: -112.97, kind: "beach" };
  const village = { lat: 53.005, lng: -112.9925, kind: "village" };
  const farVillage = { lat: 53.005, lng: -112.955, kind: "village" };
  const peak = { lat: 53.005, lng: -112.994, kind: "peak" };
  assert.equal(isNearCroppedRoute(beach, track), true);
  assert.equal(isNearCroppedRoute(farBeach, track), false);
  assert.equal(isNearCroppedRoute(village, track), true);
  assert.equal(isNearCroppedRoute(farVillage, track), false);
  assert.equal(isNearCroppedRoute(peak, track), false);
  assert.ok(distToTrackM([beach.lat, beach.lng], track) > 100);
  assert.ok(distToTrackM([beach.lat, beach.lng], track) <= 500);
  assert.ok(distToTrackM([village.lat, village.lng], track) > 100);
  assert.ok(distToTrackM([village.lat, village.lng], track) <= 1000);
  assert.equal(isNearCroppedRoute(peak, track, 500), true);
});

test("shiftRouteSpans remaps Strava indexes into a crop", () => {
  assert.deepEqual(shiftRouteSpans([{ start: 5, end: 10 }], 3, 8), [{ start: 2, end: 5 }]);
  assert.deepEqual(shiftRouteSpans([{ start: 5, end: 10 }], 0, 2), []);
  assert.equal(shiftRouteSpans(undefined, 0, 10), undefined);
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

  const withBeach = schematicBbox(track, [{ lat: 53.005, lng: -112.985, distToRouteM: 400, kind: "beach" }]);
  assert.ok(withBeach[1][0] > tight[1][0]);
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
