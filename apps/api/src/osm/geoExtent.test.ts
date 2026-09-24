import assert from "node:assert/strict";
import test from "node:test";
import { clipWaysToVariableCorridor } from "./corridor";
import {
  clipWaysKeepingTouchedAreas,
  touchedAreaRings,
  convexHullRing,
  endRadiusM,
  loopBandRing,
  radiusAlongRoute,
  rectangleRing,
  rotatedBoxRing,
  shapePadM,
} from "./geoExtent";

const line = (coordinates: number[][]) => ({
  features: [{ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} }],
});

const polygon = (ring: number[][]) => ({
  features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }],
});

test("a rotated box around a diagonal is tighter than the axis-aligned box", () => {
  const route: [number, number][] = [];
  for (let i = 0; i <= 20; i += 1) route.push([i * 0.01, i * 0.01]);
  const ring = rotatedBoxRing(route, 100);
  assert.equal(ring.length, 4);
  const area = ringArea(ring);
  const aabb = (0.2 * 111_320) ** 2;
  assert.ok(area < aabb * 0.35, `rotated area ${area} should be well under the square ${aabb}`);
});

test("a convex hull drops an interior point and padding grows the outline", () => {
  const route: [number, number][] = [
    [0, 0],
    [0, 0.02],
    [0.02, 0.02],
    [0.02, 0],
    [0.01, 0.01],
  ];
  const tight = convexHullRing(route, 0);
  const padded = convexHullRing(route, 200);
  assert.equal(tight.length, 4);
  assert.ok(ringArea(padded) > ringArea(tight));
});

test("a closed square keeps an interior band and an open line does not", () => {
  const loop: [number, number][] = [
    [0, 0],
    [0, 0.02],
    [0.02, 0.02],
    [0.02, 0],
    [0, 0],
  ];
  const ring = loopBandRing(loop, 150);
  assert.ok(ring && ring.length >= 4);
  assert.ok(ringArea(ring!) > ringArea(convexHullRing(loop, 0)));
  const open: [number, number][] = [
    [0, 0],
    [0, 0.01],
    [0.01, 0.01],
  ];
  assert.equal(loopBandRing(open, 150), null);
});

test("ends are wider than the middle", () => {
  const route: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) route.push([0, i * 0.002]);
  const mid = 400;
  const radii = radiusAlongRoute(route, mid, endRadiusM(mid));
  assert.ok(radii[0] > radii[20] + 200);
  assert.ok(radii[radii.length - 1] > radii[20] + 200);
  assert.ok(Math.abs(radii[20] - mid) < 1);
});

test("a wider end keeps nearby geometry that the middle drops", () => {
  const route: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) route.push([0, i * 0.002]);
  const radii = radiusAlongRoute(route, 200, 2_000);
  const ways = {
    roads: line([
      [0.001, 0.002],
      [0.006, 0.002],
    ]),
    streets: line([
      [0.04, 0.0045],
      [0.05, 0.0045],
    ]),
  };
  const clipped = clipWaysToVariableCorridor(ways, route, radii);
  assert.ok((clipped.roads.features?.length ?? 0) >= 1, "start-side road stays");
  assert.equal(clipped.streets.features?.length ?? 0, 0, "middle road outside the tight band drops");
});

test("parks and lakes the route meets stay whole while distant ones drop", () => {
  const route: [number, number][] = [
    [0, 0],
    [0, 0.01],
    [0, 0.02],
  ];
  const touched = [
    [0.002, -0.002],
    [-0.002, -0.002],
    [-0.002, 0.022],
    [0.002, 0.022],
    [0.002, -0.002],
  ];
  const far = [
    [0.05, 0.05],
    [0.05, 0.06],
    [0.06, 0.06],
    [0.06, 0.05],
    [0.05, 0.05],
  ];
  const ways = {
    parks: polygon(touched),
    water: polygon(far),
    roads: line([
      [0, 0.02],
      [0.02, 0.02],
    ]),
  };
  const clipped = clipWaysKeepingTouchedAreas(ways, route, 400);
  assert.equal(clipped.parks.features?.length, 1);
  const kept = clipped.parks.features?.[0] as { geometry: { coordinates: number[][][] } };
  assert.equal(kept.geometry.coordinates[0].length, touched.length);
  assert.equal(clipped.water.features?.length ?? 0, 0);
  assert.equal(clipped.roads.features?.length ?? 0, 0);
  const rings = touchedAreaRings(ways, route, 400);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, touched.length);
});

test("rectangleRing orders opposite corners", () => {
  assert.deepEqual(rectangleRing([2, 3], [0, 1]), [
    [0, 1],
    [2, 1],
    [2, 3],
    [0, 3],
  ]);
});

test("shape padding stays inside 150–800 m", () => {
  const tiny: [number, number][] = [[0, 0], [0, 0.001]];
  const huge: [number, number][] = [[0, 0], [1, 1]];
  assert.ok(shapePadM(tiny) >= 150);
  assert.ok(shapePadM(huge) <= 800);
});

function ringArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  const lat = ring[0]?.[1] ?? 0;
  const meters = 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.abs(sum / 2) * meters * 111_320;
}
