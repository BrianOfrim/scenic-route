import assert from "node:assert/strict";
import test from "node:test";
import {
  CORRIDOR_CAP_M,
  clipWaysToCorridor,
  corridorForRoute,
  defaultCorridorM,
  formatCorridorM,
  type LatLng,
} from "./corridor";

const north = (lat: number, lng = -114): LatLng => [lat, lng];

test("open-route default is 8% of the diagonal, clamped and snapped", () => {
  assert.equal(defaultCorridorM([north(53), north(53.05)], false), 450);
  assert.equal(defaultCorridorM([north(53), north(53.001)], false), 300);
  assert.equal(defaultCorridorM([north(53), north(53.4)], false), CORRIDOR_CAP_M);
});

test("a loop keeps the interior when that is wider than the scaled band", () => {
  const lat = 53;
  const side = 10_000;
  const dLat = side / 111_320;
  const dLng = side / (111_320 * Math.cos((lat * Math.PI) / 180));
  const square: LatLng[] = [
    [lat, -114],
    [lat, -114 + dLng],
    [lat + dLat, -114 + dLng],
    [lat + dLat, -114],
    [lat, -114],
  ];
  const open = corridorForRoute(square, false);
  const closed = corridorForRoute(square, true);
  assert.ok(open.meters < CORRIDOR_CAP_M);
  assert.equal(open.maxM, CORRIDOR_CAP_M);
  assert.equal(closed.meters, 5_000);
  assert.equal(closed.maxM, 5_000);
  assert.equal(closed.minM, 200);
});

test("formatCorridorM uses metres under 1 km and kilometres above", () => {
  assert.equal(formatCorridorM(450), "450 m");
  assert.equal(formatCorridorM(2_000), "2 km");
  assert.equal(formatCorridorM(1_500), "1.5 km");
});

test("lines far from the route are dropped and crossings are cut", () => {
  const route = [north(51), north(51.02)];
  const near = line([[-114, 51.005], [-114, 51.015]], "near");
  const far = line([[-113.9, 51.005], [-113.9, 51.015]], "far");
  const crossing = line([[-114, 51.01], [-113.98, 51.01]], "cross");
  const clipped = clipWaysToCorridor(
    { roads: { type: "FeatureCollection", features: [near, far, crossing] } },
    route,
    500,
  );
  const names = clipped.roads.features.map((feature) => feature.properties?.name);
  assert.deepEqual(names.sort(), ["cross", "near"]);
  const cross = clipped.roads.features.find((feature) => feature.properties?.name === "cross");
  const coords = (cross?.geometry?.coordinates ?? []) as number[][];
  const maxLng = Math.max(...coords.map((point) => point[0]));
  const cos = Math.cos((51.01 * Math.PI) / 180);
  const edge = -114 + 500 / (111_320 * cos);
  assert.ok(Math.abs(maxLng - edge) < 0.0008, `cut at ${maxLng}, expected near ${edge}`);
  assert.equal(near.geometry?.coordinates.length, 2);
});

test("a polygon is trimmed to the corridor", () => {
  const route = [north(51), north(51.02)];
  const wide = {
    type: "Feature",
    properties: { name: "woods" },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-114.002, 51.004],
        [-113.95, 51.004],
        [-113.95, 51.016],
        [-114.002, 51.016],
        [-114.002, 51.004],
      ]],
    },
  };
  const away = {
    type: "Feature",
    properties: { name: "elsewhere" },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-113.85, 51.004],
        [-113.8, 51.004],
        [-113.8, 51.016],
        [-113.85, 51.016],
        [-113.85, 51.004],
      ]],
    },
  };
  const clipped = clipWaysToCorridor({ forest: { features: [wide, away] } }, route, 500);
  assert.equal(clipped.forest.features.length, 1);
  assert.equal(clipped.forest.features[0].properties?.name, "woods");
  const lngs = coordinatesOf(clipped.forest.features[0].geometry).map((point) => point[0]);
  const cos = Math.cos((51.01 * Math.PI) / 180);
  const reach = 500 / (111_320 * cos);
  assert.ok(Math.max(...lngs) <= -114 + reach + 0.0008);
  assert.ok(Math.min(...lngs) >= -114 - reach - 0.0008);
  assert.ok(Math.max(...lngs) > -114.01);
});

test("a diagonal route drops geometry in the empty corner of its box", () => {
  const route: LatLng[] = [
    [51, -114],
    [51.02, -113.98],
  ];
  const corner = {
    type: "Feature",
    properties: { name: "corner" },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-114.001, 51.018],
        [-113.998, 51.018],
        [-113.998, 51.021],
        [-114.001, 51.021],
        [-114.001, 51.018],
      ]],
    },
  };
  const clipped = clipWaysToCorridor({ forest: { features: [corner] } }, route, 400);
  assert.equal(clipped.forest.features.length, 0);
});

function line(coordinates: number[][], name: string) {
  return {
    type: "Feature",
    properties: { name },
    geometry: { type: "LineString", coordinates },
  };
}

function coordinatesOf(geometry: { type?: string; coordinates?: unknown } | null | undefined): number[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][]).flat();
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).flat(2);
  if (geometry.type === "LineString") return geometry.coordinates as number[][];
  return [];
}
