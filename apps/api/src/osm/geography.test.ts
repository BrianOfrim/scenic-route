import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Feature, FeatureCollection } from "geojson";
import { automaticGeographyAllowance, geographyPolicy, geographySelectors, resolveGeographyScene } from "./geographyPolicy";
import { loadGeography, parseGeographyBbox } from "./geography";
import { queryOverpass } from "./overpass";
import type { BBox } from "../geo";
import { waterClass } from "./waterClasses";

const city: BBox = [-113.52, 53.51, -113.47, 53.54];
const country: BBox = [-125, 44, -65, 56];
const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const square = (x: number, y: number, d: number): Feature => ({ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]] } });

test("OSM and bundled water sources retain subtype identity", () => {
  const tagged = (tags: Record<string, string>): Feature => ({ ...square(0, 0, .01), properties: { tags } });
  assert.equal(waterClass(tagged({ natural: "water", water: "reservoir" })), "reservoir");
  assert.equal(waterClass(tagged({ landuse: "reservoir" })), "reservoir");
  assert.equal(waterClass(tagged({ natural: "water", water: "river" })), "river");
  assert.equal(waterClass(tagged({ natural: "water" })), "water");
  assert.equal(waterClass({ ...square(0, 0, .01), properties: { id: "ne/ocean/1" } }), "ocean");
  assert.equal(waterClass({ ...square(0, 0, .01), properties: { id: "ne/lakes/1" } }), "lake");
});

test("scale follows frame and aspect, with distinct local through continental profiles", () => {
  assert.equal(geographyPolicy(city).profile, "local");
  assert.equal(geographyPolicy([-113.7, 53.4, -113.2, 53.7]).profile, "district");
  assert.equal(geographyPolicy([-115, 52, -112, 54]).profile, "regional");
  assert.equal(geographyPolicy(country).profile, "wide");
  assert.notEqual(geographyPolicy([-114,53,-113,53.1], "3:4").metersPerPixel,
    geographyPolicy([-114,53,-113,53.1], "16:9").metersPerPixel);
  assert.match(geographySelectors("local").join(), /residential/);
  assert.doesNotMatch(geographySelectors("district").join(), /residential|service|footway/);
  assert.match(geographySelectors("district").join(), /stream/);
});

test("automatic summary describes allowed classes independently of data present", () => {
  const local = automaticGeographyAllowance("local", "overpass");
  const district = automaticGeographyAllowance("district", "overpass");
  const wide = automaticGeographyAllowance("wide", "natural-earth");
  assert.match(local.categories.join(), /paths and trails|ponds|streams/);
  assert.match(district.categories.join(), /route-near streams|large or route-near ponds/);
  assert.doesNotMatch(district.categories.join(), /paths and trails|farmland/);
  assert.match(wide.categories.join(), /urban footprints|coastline and ocean/);
  assert.doesNotMatch(wide.categories.join(), /ponds|streams|parks/);
  assert.deepEqual(automaticGeographyAllowance("local", "natural-earth"), wide);
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

test("district water keeps lakes and route-adjacent ponds, while suppressing distant ponds and streams", () => {
  const policy = geographyPolicy([0, 0, .25, .25], "1:1");
  assert.equal(policy.profile, "district");
  const pond = (x: number): Feature => ({ ...square(x, .1, .0008), properties: { tags: { natural: "water", water: "pond" } } });
  const lake: Feature = { ...square(.18, .1, .01), properties: { tags: { natural: "water", water: "lake" } } };
  const stream = (x: number): Feature => ({ type: "Feature", properties: { tags: { waterway: "stream" } },
    geometry: { type: "LineString", coordinates: [[x, .04], [x, .1], [x, .2]] } });
  const result = resolveGeographyScene({ water: collection([pond(.03), pond(.08), lake]),
    waterways: collection([stream(.03), stream(.08)]) }, policy, [[.1, .03]]);
  assert.equal(result.water.features.length, 2);
  assert.equal(result.waterways.features.length, 1);
});

test("river polygons are assigned to Rivers without adding an editor category", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const river = { ...square(-113.5, 53.52, .005), properties: { tags: { natural: "water", water: "river" } } };
  const scene = await loadGeography(city, "3:4", "auto", undefined, { sceneDir: dir,
    query: async () => collection([river]) });
  assert.equal(scene.ways.riverAreas.features.length, 1);
  assert.equal(scene.ways.water.features.length, 0);
  assert.ok(scene.featureIds.includes("rivers"));
  assert.ok(!scene.featureIds.includes("lakes"));
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

test("regional OSM scenes use explicit land and ocean beneath detailed features", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const westCoastFrame: BBox = [-125.1692, 48.3175, -124.3707, 49.0204];
  const coast: Feature = { type: "Feature", properties: { tags: { natural: "coastline" } },
    geometry: { type: "LineString", coordinates: [[-125.2, 48.7], [-124.3, 48.7]] } };
  const scene = await loadGeography(westCoastFrame, "3:4", "auto", undefined, { sceneDir: dir,
    query: async () => collection([coast]) });
  assert.equal(scene.profile, "regional");
  assert.equal(scene.source, "overpass");
  assert.ok(scene.ways.land.features.length > 0);
  assert.ok(scene.ways.ocean.features.length > 0);
  assert.ok(scene.ways.ocean.features.every(feature => String(feature.properties?.id).startsWith("ne/ocean/")),
    "fragmented OSM coastlines must not turn the whole frame into synthetic ocean");
  assert.ok(scene.ways.coastline.features.length > 0);
});

test("manual mode requests Overpass even for a wide frame and does not generalize its features", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const scene = await loadGeography(country, "3:4", "manual", undefined, { sceneDir: dir,
    query: async (query, _bbox, _warnings, _label, _post, budget) => {
      calls++;
      assert.match(query, /residential|footway|wetland/);
      assert.equal(budget?.maxTiles, 64);
      return collection([{ ...square(-110, 50, .0001), properties: { tags: { natural: "water", water: "pond" } } }]);
    } });
  assert.equal(calls, 1);
  assert.equal(scene.source, "overpass");
  assert.equal(scene.completeness, "complete");
  assert.equal(scene.ways.water.features.length, 1, "manual mode does not apply the auto area threshold");
});

test("manual mode reports Overpass limits and failures without substituting bundled data", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(loadGeography(country, "3:4", "manual", undefined, { sceneDir: dir }), /OpenStreetMap.*tile budget/);
  await assert.rejects(loadGeography(city, "3:4", "manual", undefined, { sceneDir: dir,
    query: async () => { throw new Error("simulated outage"); } }), /OpenStreetMap.*simulated outage/);
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
