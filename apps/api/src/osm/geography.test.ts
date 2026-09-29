import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Feature, FeatureCollection } from "geojson";
import { geographyPolicy, geographySelectors, resolveGeographyScene } from "./geographyPolicy";
import { loadGeography, parseGeographyBbox } from "./geography";
import { queryOverpass } from "./overpass";
import type { BBox } from "../geo";

const city: BBox = [-113.52, 53.51, -113.47, 53.54];
const country: BBox = [-125, 44, -65, 56];
const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const square = (x: number, y: number, d: number): Feature => ({ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]] } });

test("scale follows frame and aspect, with distinct local through continental profiles", () => {
  assert.equal(geographyPolicy(city).profile, "local");
  assert.equal(geographyPolicy([-113.7, 53.4, -113.2, 53.7]).profile, "district");
  assert.equal(geographyPolicy([-115, 52, -112, 54]).profile, "regional");
  assert.equal(geographyPolicy(country).profile, "wide");
  assert.notEqual(geographyPolicy([-114,53,-113,53.1], "3:4").metersPerPixel,
    geographyPolicy([-114,53,-113,53.1], "16:9").metersPerPixel);
  assert.match(geographySelectors("local").join(), /residential/);
  assert.doesNotMatch(geographySelectors("district").join(), /residential|service|footway|stream/);
});

test("pixel-size selection protects legible route-adjacent ponds and preserves polygon holes", () => {
  const policy = geographyPolicy([0, 0, .01, .01], "1:1");
  const small = square(.002, .002, .000025);
  const large = square(.004, .004, .002);
  if (large.geometry.type === "Polygon") large.geometry.coordinates.push([[.0045,.0045],[.005,.0045],[.005,.005],[.0045,.005],[.0045,.0045]]);
  const ways = { water: collection([small, large]) };
  assert.equal(resolveGeographyScene(ways, policy).water.features.length, 1);
  const nearby = resolveGeographyScene(ways, policy, [[.002,.002]]);
  assert.equal(nearby.water.features.length, 2);
  assert.deepEqual(nearby.water.features[1].geometry, large.geometry);
});

test("line generalization preserves shared junctions and short main-road segments", () => {
  const main: Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0,0],[.001,0],[.002,0],[.003,0]] } };
  const branch: Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[.001,0],[.001,.00001]] } };
  const result = resolveGeographyScene({ roads: collection([main, branch]) }, geographyPolicy([0,0,1,1]));
  assert.equal(result.roads.features.length, 2);
  const line = result.roads.features[0].geometry;
  assert.equal(line.type, "LineString");
  if (line.type === "LineString") assert.deepEqual(line.coordinates, [[0,0],[.001,0],[.003,0]]);
});

test("wide scenes use bundled assets without network and reproduce saved geometry", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = { sceneDir: dir, query: async () => { throw new Error("Unexpected network query"); } };
  const scene = await loadGeography(country, "3:4", "auto", undefined, options);
  assert.equal(scene.source, "natural-earth");
  for (const bucket of ["water", "waterways", "roads", "urban"]) assert.ok(scene.ways[bucket].features.length > 0, bucket);
  assert.ok(scene.sceneId);
  assert.deepEqual(await loadGeography(country, "3:4", "auto", scene.sceneId, options), scene);
});

test("cropping a wide route to a city retrieves local classes; failures report a generalized fallback", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const scene = await loadGeography(city, "3:4", "auto", undefined, { sceneDir: dir, query: async (query, _bbox, warnings) => {
    calls++;
    assert.match(query, /residential/);
    warnings.push("Simulated upstream failure");
    return collection([]);
  } });
  assert.equal(calls, 1);
  assert.equal(scene.profile, "local");
  assert.equal(scene.completeness, "fallback");
  assert.match(scene.warnings.join(), /small local features may be absent/);
});

test("Overpass budgets stop requests before constructing a continental tile grid", async () => {
  const warnings: string[] = [];
  await queryOverpass("out geom;", country, warnings, "test", async () => { throw new Error("must not query"); },
    { maxTiles: 8, timeoutMs: 1000, maxBytes: 1024, queryTimeoutS: 1 });
  assert.match(warnings.join(), /tile budget/);
  for (const bbox of [[0,0,0,1], [-181,0,1,1], [0,0,1,90], [0,0,"1",1], [0,0,NaN,1]]) assert.throws(() => parseGeographyBbox(bbox));
});

test("automatic queries stop waiting at their deadline and reject oversized cumulative data", async () => {
  const timeoutWarnings: string[] = [];
  await queryOverpass("out geom;", city, timeoutWarnings, "deadline", () => new Promise(() => {}),
    { maxTiles: 8, timeoutMs: 10, maxBytes: 1024, queryTimeoutS: 1 });
  assert.match(timeoutWarnings.join(), /deadline exceeded/);
  const sizeWarnings: string[] = [];
  await queryOverpass("out geom;", city, sizeWarnings, "size", async () => ({ elements: [] }),
    { maxTiles: 8, timeoutMs: 1000, maxBytes: 1, queryTimeoutS: 1 });
  assert.match(sizeWarnings.join(), /response budget/);
});
