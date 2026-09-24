import assert from "node:assert/strict";
import test from "node:test";
import { clipWaysToVariableCorridor } from "./corridor";
import {
  clipWaysKeepingTouchedAreas,
  clipWaysSoftThenHard,
  clipWaysToRing,
  touchedAreaRings,
  convexHullRing,
  endRadiusM,
  keepWaysTouchingRing,
  outerExpandM,
  outerHardCut,
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

test("a line that enters a ring is kept through to its far end", () => {
  const ring: [number, number][] = [
    [-0.002, 0],
    [0.002, 0],
    [0.002, 0.01],
    [-0.002, 0.01],
  ];
  const crossing = [[0, 0.005], [0.05, 0.005]];
  const outside = [[0.04, 0.004], [0.05, 0.006]];
  const kept = keepWaysTouchingRing(
    {
      roads: {
        features: [
          { geometry: { type: "LineString", coordinates: crossing } },
          { geometry: { type: "LineString", coordinates: outside } },
        ],
      },
    },
    ring,
  );
  assert.equal(kept.roads.features?.length, 1);
  const feature = kept.roads.features?.[0] as { geometry: { coordinates: number[][] } };
  assert.deepEqual(feature.geometry.coordinates, crossing);
});

test("a kept line is hard-cut at the outer ring", () => {
  const ring: [number, number][] = [
    [-0.01, -0.01],
    [0.01, -0.01],
    [0.01, 0.01],
    [-0.01, 0.01],
  ];
  const crossing = [[0, 0], [0.05, 0]];
  const clipped = clipWaysToRing({ roads: line(crossing) }, ring);
  const feature = clipped.roads.features?.[0] as { geometry: { coordinates: number[][] } };
  const end = feature.geometry.coordinates.at(-1) ?? [];
  assert.ok(end[0] < 0.02, `expected the line to stop near the ring, got ${end[0]}`);
  assert.ok(end[0] > 0.005);
});

test("a touching line is kept out to the further corridor and a line in the gap is dropped", () => {
  const route: [number, number][] = [[51, -114], [51.02, -114]];
  const expand = outerExpandM(route);
  const corridorM = 400;
  const cos = Math.cos((51.01 * Math.PI) / 180);
  const metersToLng = (meters: number) => meters / (111_320 * cos);
  const touching = [[-114, 51.01], [-113.98, 51.01]];
  const gapStart = -114 + metersToLng(corridorM + expand / 2);
  const gap = [[gapStart, 51.01], [-113.98, 51.01]];
  const clipped = clipWaysSoftThenHard(
    {
      roads: {
        features: [
          { geometry: { type: "LineString", coordinates: touching } },
          { geometry: { type: "LineString", coordinates: gap } },
        ],
      },
    },
    route,
    "corridor",
    { corridorM },
  );
  assert.equal(clipped.roads.features?.length, 1);
  const coords = (clipped.roads.features?.[0] as { geometry: { coordinates: number[][] } }).geometry.coordinates;
  const maxLng = Math.max(...coords.map((point) => point[0]));
  const inner = -114 + metersToLng(corridorM);
  const outer = -114 + metersToLng(corridorM + expand);
  assert.ok(maxLng > inner + 0.0004, `expected the line past the inner scope, got ${maxLng}`);
  assert.ok(Math.abs(maxLng - outer) < 0.001, `cut at ${maxLng}, expected near ${outer}`);
});

test("the satellite hard cut sits further out than the inner scope", () => {
  const route: [number, number][] = [];
  for (let i = 0; i <= 20; i += 1) route.push([51 + i * 0.001, -114]);
  const expand = outerExpandM(route);
  const corridorM = 400;
  const corridor = outerHardCut(route, "corridor", { corridorM });
  assert.deepEqual(corridor, { kind: "band", bandM: corridorM + expand });

  const ends = outerHardCut(route, "ends", { corridorM });
  assert.equal(ends?.kind, "band");
  assert.ok(ends?.kind === "band" && Array.isArray(ends.bandM));
  if (ends?.kind !== "band" || !Array.isArray(ends.bandM)) return;
  assert.equal(ends.bandM[0], endRadiusM(corridorM) + expand);
  assert.equal(ends.bandM[Math.floor(ends.bandM.length / 2)], corridorM + expand);
  assert.ok(ends.bandM[0] > ends.bandM[Math.floor(ends.bandM.length / 2)]);

  const ring: [number, number][] = [
    [-0.004, -0.004],
    [0.004, -0.004],
    [0.004, 0.004],
    [-0.004, 0.004],
  ];
  const cut = outerHardCut(route, "ring", { ring });
  assert.equal(cut?.kind, "ring");
  if (cut?.kind !== "ring") return;
  const innerEast = Math.max(...ring.map((point) => point[0]));
  const outerEast = Math.max(...cut.ring.map((point) => point[0]));
  assert.ok(outerEast > innerEast + 0.003, `outer edge ${outerEast} should sit past ${innerEast}`);

  const inside = [[0, 0], [0.05, 0]];
  const onlyOuter = [[innerEast + 0.001, 0], [0.05, 0]];
  const clipped = clipWaysSoftThenHard(
    {
      roads: {
        features: [
          { geometry: { type: "LineString", coordinates: inside } },
          { geometry: { type: "LineString", coordinates: onlyOuter } },
        ],
      },
    },
    route,
    "ring",
    { ring },
  );
  assert.equal(clipped.roads.features?.length, 1);
  const coords = (clipped.roads.features?.[0] as { geometry: { coordinates: number[][] } }).geometry.coordinates;
  const maxLng = Math.max(...coords.map((point) => point[0]));
  assert.ok(maxLng > innerEast + 0.002, `line should pass the inner ring, got ${maxLng}`);
  assert.ok(maxLng < outerEast + 0.001, `line should stop at the outer ring, got ${maxLng} vs ${outerEast}`);
});

test("outer expand stays inside 0.5–2 km", () => {
  const tiny: [number, number][] = [[0, 0], [0, 0.01]];
  const huge: [number, number][] = [[0, 0], [2, 2]];
  assert.ok(outerExpandM(tiny) >= 500);
  assert.ok(outerExpandM(huge) <= 2000);
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
