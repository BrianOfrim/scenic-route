import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Feature, FeatureCollection } from "geojson";
import { automaticGeographyAllowance, geographyPolicy, geographyProfileForScale, geographySelectors, resolveGeographyScene } from "./geographyPolicy";
import { extendGeography, geographyQuery, loadGeography, parseGeographyBbox } from "./geography";
import { queryOverpass, type OverpassQueryStats } from "./overpass";
import { tileBboxes, type BBox } from "../geo";
import { waterClass } from "./waterClasses";

const city: BBox = [-113.52, 53.51, -113.47, 53.54];
const country: BBox = [-125, 44, -65, 56];
const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const square = (x: number, y: number, d: number): Feature => ({ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]] } });

test("selective manual layers follow scale thresholds and load only requested categories", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-manual-scale-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pond = { ...square(-113.5, 53.52, .001), properties: { tags: { natural: "water", water: "pond" } } };
  const forest = { ...square(-113.5, 53.52, .001), properties: { tags: { landuse: "forest" } } };
  const seen: string[] = [];
  const query = async (body: string) => { seen.push(body); return collection([pond, forest]); };
  const small = await loadGeography(city, "3:4", "manual", undefined, { sceneDir: dir, query, featureIds: ["lakes"] });
  const large = await loadGeography([-114, 53, -113, 54], "3:4", "manual", undefined, { sceneDir: dir, query, featureIds: ["lakes"] });
  assert.equal(small.ways.water.features.length, 1, "local pond is legible");
  assert.equal(large.ways.water.features.length, 0, "same pond is too small in regional view");
  assert.equal(small.ways.forest.features.length, 0, "unrequested category is not included");
  assert.deepEqual(small.loadedFeatureIds, ["lakes"]);
  assert.deepEqual(large.loadedFeatureIds, ["lakes"], "empty results count as loaded");
  assert.ok(seen.every(body => body.includes("nwr[natural=water]") && !body.includes("landuse=forest")));
});

test("manually enabled paths retain scale-based line simplification", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-manual-line-scale-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const coordinates = Array.from({ length: 101 }, (_, index) =>
    [-113.5 + index * .00006, 53.52 + index * .00004 + (index % 2 ? .0001 : -.0001)]);
  const feature: Feature = { type: "Feature", properties: { tags: { highway: "path" } }, geometry: { type: "LineString", coordinates } };
  const options = { sceneDir: dir, featureIds: ["paths"], query: async () => collection([feature]) };
  const small = await loadGeography(city, "3:4", "manual", undefined, options);
  const large = await loadGeography([-114, 53, -113, 54], "3:4", "manual", undefined, options);
  const a = small.ways.paths.features[0].geometry;
  const b = large.ways.paths.features[0].geometry;
  assert.equal(a.type, "LineString"); assert.equal(b.type, "LineString");
  if (a.type !== "LineString" || b.type !== "LineString") return;
  assert.ok(b.coordinates.length < a.coordinates.length, "larger scale removes detail smaller than a pixel");
  for (const index of [0, a.coordinates.length - 1]) {
    const left = index === 0 ? a.coordinates[0] : a.coordinates.at(-1)!;
    const right = index === 0 ? b.coordinates[0] : b.coordinates.at(-1)!;
    assert.ok(left.every((value, axis) => Math.abs(value - right[axis]) < 1e-9), "endpoints survive projection rounding");
  }
});

test("rivers load their filled areas without requiring the Lakes layer", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-manual-river-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scene = await loadGeography(city, "3:4", "manual", undefined, { sceneDir: dir, featureIds: ["rivers"],
    query: async body => {
      assert.ok(body.includes('nwr[water~"^(river|stream|canal)$"]'));
      return collection([{ ...square(-113.51, 53.52, .01), properties: { tags: { natural: "water", water: "river" } } }]);
    } });
  assert.equal(scene.ways.riverAreas.features.length, 1);
  assert.ok(scene.featureIds.includes("rivers"));
});

test("extending a scene preserves existing geography, caches empty coverage, and restores in manual mode", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-manual-extension-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bbox: BBox = [-113.7, 53.4, -113.3, 53.6];
  const base = await loadGeography(bbox, "3:4", "auto", undefined, { sceneDir: dir,
    query: async () => collection([{ ...square(-113.55, 53.5, .02), properties: { tags: { landuse: "forest" } } }]) });
  let calls = 0;
  const options = { sceneDir: dir, query: async (body: string) => {
    calls++;
    assert.ok(body.includes("highway"));
    assert.ok(!body.includes("landuse=forest"));
    return collection([]);
  } };
  const restoredBase = await loadGeography(bbox, "3:4", "manual", base.sceneId, { sceneDir: dir,
    query: async () => { throw new Error("restoration should not query"); } });
  assert.deepEqual(restoredBase, base, "manual can inherit the existing automatic scene");
  const extended = await extendGeography(bbox, "3:4", base.sceneId, ["paths"], options);
  assert.equal(calls, 1);
  assert.deepEqual(extended.ways.forest, base.ways.forest);
  assert.ok(extended.loadedFeatureIds?.includes("paths"));
  assert.equal(extended.ways.paths.features.length, 0);
  assert.equal((await extendGeography(bbox, "3:4", extended.sceneId, ["paths"], options)).sceneId, extended.sceneId);
  assert.equal(calls, 1, "an empty category is not fetched again");
  const restored = await loadGeography(bbox, "3:4", "manual", extended.sceneId, { sceneDir: dir,
    query: async () => { throw new Error("restoration should not query"); } });
  assert.deepEqual(restored, extended);
  await assert.rejects(extendGeography(city, "3:4", extended.sceneId, ["paths"], options), /frame has changed/);
  await assert.rejects(extendGeography(bbox, "3:4", base.sceneId, ["paths"], { sceneDir: dir,
    query: async () => { throw new Error("provider down"); } }), /provider down/);
  assert.deepEqual(await loadGeography(bbox, "3:4", "auto", base.sceneId, { sceneDir: dir }), base, "failed layer fetch leaves original intact");
});

test("reopening a saved fallback preserves it, while retry without its scene ID rebuilds detail", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-geography-fallback-retry-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const options = { sceneDir: dir, query: async () => {
    calls++;
    if (calls === 1) throw new Error("temporary provider failure");
    return collection([{ ...square(-113.51, 53.52, .01), properties: { tags: { landuse: "forest" } } }]);
  } };
  const fallback = await loadGeography(city, "3:4", "auto", undefined, options);
  assert.equal(fallback.completeness, "fallback");
  assert.deepEqual(await loadGeography(city, "3:4", "auto", fallback.sceneId, options), fallback);
  assert.equal(calls, 1, "ordinary reopening restores saved geography");
  const detailed = await loadGeography(city, "3:4", "auto", undefined, options);
  assert.equal(calls, 2, "retry without the saved scene ID requests detail again");
  assert.equal(detailed.source, "overpass");
  assert.equal(detailed.completeness, "complete");
  assert.ok(detailed.ways.forest.features.length > 0);
  assert.notEqual(detailed.sceneId, fallback.sceneId);
});

test("OSM and bundled water sources retain subtype identity", () => {
  const tagged = (tags: Record<string, string>): Feature => ({ ...square(0, 0, .01), properties: { tags } });
  assert.equal(waterClass(tagged({ natural: "water", water: "reservoir" })), "reservoir");
  assert.equal(waterClass(tagged({ landuse: "reservoir" })), "reservoir");
  assert.equal(waterClass(tagged({ natural: "water", water: "river" })), "river");
  assert.equal(waterClass(tagged({ natural: "water" })), "water");
  assert.equal(waterClass({ ...square(0, 0, .01), properties: { id: "ne/ocean/1" } }), "ocean");
  assert.equal(waterClass({ ...square(0, 0, .01), properties: { id: "ne/lakes/1" } }), "lake");
});

test("scale follows frame and aspect across five Overpass levels and bundled wide maps", () => {
  for (const [scale, profile] of [[2.99, "close-up"], [3, "local"], [9.99, "local"], [10, "town"],
    [24.99, "town"], [25, "district"], [49.99, "district"], [50, "regional"],
    [99.99, "regional"], [100, "wide"]] as const) {
    assert.equal(geographyProfileForScale(scale), profile);
  }
  assert.equal(geographyPolicy([-113.51, 53.495, -113.49, 53.505]).profile, "close-up");
  assert.equal(geographyPolicy(city).profile, "local");
  assert.equal(geographyPolicy([-113.6, 53.45, -113.4, 53.55]).profile, "town");
  assert.equal(geographyPolicy([-113.7, 53.4, -113.3, 53.6]).profile, "district");
  assert.equal(geographyPolicy([-113.9, 53.3, -113.1, 53.7]).profile, "regional");
  assert.equal(geographyPolicy(country).profile, "wide");
  assert.notEqual(geographyPolicy([-114,53,-113,53.1], "3:4").metersPerPixel,
    geographyPolicy([-114,53,-113,53.1], "16:9").metersPerPixel);
  assert.match(geographySelectors("close-up").join(), /service|garden|recreation_ground/);
  assert.match(geographySelectors("local").join(), /residential/);
  assert.doesNotMatch(geographySelectors("local").join(), /service|garden|recreation_ground/);
  assert.match(geographySelectors("town").join(), /cycleway|track/);
  assert.doesNotMatch(geographySelectors("town").join(), /residential|footway|stream/);
  assert.doesNotMatch(geographySelectors("district").join(), /residential|service|footway|cycleway|track/);
  assert.match(geographySelectors("local").join(), /stream/);
  assert.doesNotMatch(geographySelectors("district").join(), /stream/);
  assert.match(geographySelectors("district").join(), /unclassified/);
  assert.doesNotMatch(geographySelectors("regional").join(), /unclassified|stream|leisure=park/);
  const sizes = (["close-up", "local", "town", "district", "regional"] as const)
    .map(profile => geographySelectors(profile).length);
  assert.ok(sizes.every((size, index) => index === 0 || size < sizes[index - 1]));
});

test("town keeps queried cycleways while district omits paths", () => {
  const cycleway: Feature = { type: "Feature", properties: { tags: { highway: "cycleway" } },
    geometry: { type: "LineString", coordinates: [[-113.51, 53.5], [-113.49, 53.5]] } };
  const ways = { paths: collection([cycleway]) };
  const town = geographyPolicy([-113.6, 53.45, -113.4, 53.55]);
  const district = geographyPolicy([-113.7, 53.4, -113.3, 53.6]);
  assert.equal(resolveGeographyScene(ways, town).paths.features.length, 1);
  assert.equal(resolveGeographyScene(ways, district).paths.features.length, 0);
});

test("automatic summary describes allowed classes independently of data present", () => {
  const local = automaticGeographyAllowance("local", "overpass");
  const district = automaticGeographyAllowance("district", "overpass");
  const wide = automaticGeographyAllowance("wide", "natural-earth");
  assert.match(local.categories.join(), /paths and trails|ponds|streams/);
  assert.doesNotMatch(district.categories.join(), /route-near|streams/);
  const legacyRoute = automaticGeographyAllowance("district", "overpass", "route");
  assert.match(legacyRoute.categories.join(), /route-near streams|large or route-near ponds/);
  const everywhere = automaticGeographyAllowance("district", "overpass", "all");
  assert.match(everywhere.categories.join(), /paths and trails|streams|wetlands/);
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
  const nearby = resolveGeographyScene(ways, policy, [[.002,.002]], "route");
  assert.equal(nearby.water.features.length, 2);
  assert.equal(resolveGeographyScene(ways, policy, [[.002,.002]], "none").water.features.length, 1);
  assert.equal(resolveGeographyScene(ways, policy, [], "all").water.features.length, 2);
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
    waterways: collection([stream(.03), stream(.08)]) }, policy, [[.1, .03]], "route");
  assert.equal(result.water.features.length, 2);
  assert.equal(result.waterways.features.length, 1);
  const everywhere = resolveGeographyScene({ water: collection([pond(.03), pond(.08), lake]),
    waterways: collection([stream(.03), stream(.08)]) }, policy, [], "all");
  assert.equal(everywhere.water.features.length, 3);
  assert.equal(everywhere.waterways.features.length, 2);
});

test("everywhere retains minor streets and paths away from a regional route", () => {
  const policy = geographyPolicy([0, 0, .25, .25], "1:1");
  const minor = (highway: string): Feature => ({ type: "Feature", properties: { tags: { highway } },
    geometry: { type: "LineString", coordinates: [[.15, .15], [.16, .16]] } });
  const ways = { streets: collection([minor("residential")]), paths: collection([minor("footway")]) };
  const regular = resolveGeographyScene(ways, policy, [[.01, .01]], "route");
  assert.equal(regular.streets.features.length + regular.paths.features.length, 0);
  const everywhere = resolveGeographyScene(ways, policy, [[.01, .01]], "all");
  assert.equal(everywhere.streets.features.length, 1);
  assert.equal(everywhere.paths.features.length, 1);
});

test("automatic queries use each scale's selectors", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const seen: string[] = [];
  const query = async (query: string) => { seen.push(query); return collection([]); };
  const frames: BBox[] = [
    [-113.51, 53.495, -113.49, 53.505],
    city,
    [-113.6, 53.45, -113.4, 53.55],
    [-113.7, 53.4, -113.3, 53.6],
    [-113.9, 53.3, -113.1, 53.7],
  ];
  for (const bbox of frames) await loadGeography(bbox, "3:4", "auto", undefined, { sceneDir: dir, query });
  assert.equal(seen.length, 5);
  assert.match(seen[0], /service|garden/);
  assert.doesNotMatch(seen[1], /service|garden/);
  assert.match(seen[2], /cycleway|track/);
  assert.doesNotMatch(seen[3], /cycleway|track|stream/);
  assert.doesNotMatch(seen[4], /unclassified|leisure=park/);
});

test("geography classifies all candidate types before expanding geometry", () => {
  for (const selectors of [geographySelectors("district"), ['nwr[leisure~"^(park|nature_reserve|garden)$"]']]) {
    const query = geographyQuery(selectors);
    assert.match(query, /node\.candidates;/);
    assert.match(query, /way\.candidates\(if:count_members\(\) <= 10000\);/);
    assert.match(query, /rel\.candidates\(if:count_members\(\) <= 1000\);/);
    assert.match(query, /convert oversized_way/);
    assert.match(query, /convert oversized_relation/);
    assert.doesNotMatch(query, /out geom\(/);
  }
});

test("oversized summaries retain detailed geography in automatic and manual modes", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const oversized = [
    { type: "oversized_relation", id: 6535292, tags: { name: "Tongass National Forest", memberCount: "27531" } },
    { type: "oversized_way", id: 999, tags: { memberCount: "10001" } },
    { type: "oversized_relation", id: "invalid", tags: { memberCount: "bad" } },
  ];
  const payload = { elements: [
    { type: "way", id: 123, tags: { highway: "primary" }, geometry: [
      { lat: 53.52, lon: -113.5 }, { lat: 53.53, lon: -113.49 },
    ] }, ...oversized,
  ] };
  let calls = 0;
  const query: typeof queryOverpass = (body, bbox, warnings, label, _post, budget, stats) =>
    queryOverpass(body, bbox, warnings, label, async () => { calls++; return payload; }, budget, stats);
  // Two tiles deliberately return the same summaries: omit counts must deduplicate.
  const bbox: BBox = [-135.3680004, 59.5011153, -134.9747606, 59.8562177];
  const stats: OverpassQueryStats = { responseBytes: 0, omittedElements: [] };
  const warnings: string[] = [];
  const result = await queryOverpass(geographyQuery(geographySelectors("district")), bbox, warnings,
    "test", async () => payload, undefined, stats);
  assert.equal(result.features.length, 1);
  assert.equal(stats.omittedElements?.length, 2);
  assert.deepEqual(warnings, []);
  assert.equal(stats.omittedElements?.[0].type, "relation");
  assert.equal(stats.omittedElements?.[1].type, "way");
  for (const mode of ["auto", "manual"] as const) {
    const scene = await loadGeography(city, "3:4", mode, undefined, { sceneDir: dir, query });
    assert.equal(scene.source, "overpass");
    assert.equal(scene.completeness, "partial");
    assert.equal(scene.ways.roads.features.length, 1);
    assert.equal(scene.omittedElements?.length, 2);
    assert.match(scene.warnings.join(), /Tongass National Forest.*27,531 members/);
    assert.doesNotMatch(scene.warnings.join(), /generalized|unavailable/);
    const before = calls;
    assert.deepEqual(await loadGeography(city, "3:4", mode, scene.sceneId, { sceneDir: dir, query }), scene);
    assert.equal(calls, before);
  }
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

test("route detail preference is part of the saved geography scene identity", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const options = { sceneDir: dir, route: [[53.52, -113.5]] as [number, number][],
    query: async () => collection([]) };
  const on = await loadGeography(city, "3:4", "auto", undefined, { ...options, detailScope: "route" });
  assert.ok(on.queryResponseBytes && on.queryResponseBytes > 0);
  const off = await loadGeography(city, "3:4", "auto", on.sceneId, { ...options, detailScope: "none" });
  assert.notEqual(off.sceneId, on.sceneId);
  assert.deepEqual(await loadGeography(city, "3:4", "auto", off.sceneId, { ...options, detailScope: "none" }), off);
  assert.deepEqual(await loadGeography(city, "3:4", "auto", on.sceneId, { ...options, detailScope: "route" }), on);
  const everywhere = await loadGeography(city, "3:4", "auto", on.sceneId, { ...options, detailScope: "all" });
  assert.notEqual(everywhere.sceneId, on.sceneId);
  assert.deepEqual(await loadGeography(city, "3:4", "auto", everywhere.sceneId, { ...options, detailScope: "all" }), everywhere);
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

test("Galloping Goose fills the ocean when an incomplete OSM shoreline prevents inference", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geography-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bbox: BBox = [-123.7542607, 48.3421533, -123.3567553, 48.5104607];
  const coast: Feature = { type: "Feature", properties: { tags: { natural: "coastline" } },
    geometry: { type: "LineString", coordinates: [[-123.65, 48.36], [-123.6, 48.37]] } };
  const scene = await loadGeography(bbox, "3:4", "auto", undefined, { sceneDir: dir,
    query: async () => collection([coast]) });
  assert.equal(scene.profile, "district");
  assert.equal(scene.source, "overpass");
  assert.equal(scene.ways.coastline.features.length, 1);
  assert.ok(scene.ways.ocean.features.length > 0);
  const inRing = (ring: number[][], x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const oceanAt = (x: number, y: number) => scene.ways.ocean.features.some(feature => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates]
      : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [];
    return polygons.some(rings => inRing(rings[0], x, y) && !rings.slice(1).some(ring => inRing(ring, x, y)));
  });
  assert.equal(oceanAt(-123.55, 48.3), true, "the strait is filled");
  assert.equal(oceanAt(-123.55, 48.5), false, "Vancouver Island stays on land");
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

test("Overpass reports the combined query response size", async () => {
  const stats = { responseBytes: 0 };
  const payload = { elements: [] };
  await queryOverpass("out geom;", city, [], "size", async () => payload,
    { maxTiles: 8, timeoutMs: 1000, maxBytes: 1024, queryTimeoutS: 1 }, stats);
  assert.equal(stats.responseBytes, Buffer.byteLength(JSON.stringify(payload)) * tileBboxes(city).length);
});
