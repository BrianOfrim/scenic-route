import { accountContext } from "../accountLifecycle";
import { assertSafeUserId } from "../storage";
import { createHash } from "node:crypto";
import path from "node:path";
import { OSM_CACHE_DIR } from "../paths";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { Feature, FeatureCollection } from "geojson";
import type { BBox } from "../geo";
import { FEATURE_CATALOG } from "./catalog";
import { splitWays } from "./features";
import { clipWaysToQueryFrame } from "./geoExtent";
import { emptyCollection, queryOverpass, type OverpassQueryStats } from "./overpass";
import { GEOGRAPHY_BUCKETS, GEOGRAPHY_VERSION, geographyPolicy, geographySelectors, resolveGeographyScene, visibleGeographyIds, type GeographyDetailScope, type GeographyMode, type GeographyWays, type GeographyScene } from "./geographyPolicy";
import { isAreaFeature, waterClass } from "./waterClasses";
import { geographyTiming, logGeographyTiming, newGeographyTiming } from "./geographyTiming";

export type { GeographyScene } from "./geographyPolicy";

/** Heuristics for response size; byte and time budgets remain the final safeguards. */
export const GEOGRAPHY_MAX_WAY_NODES = 10_000;
export const GEOGRAPHY_MAX_RELATION_MEMBERS = 1_000;

/** Classify candidates on Overpass before expanding their coordinates. */
export function geographyQuery(selectors: string[]): string {
  return `(\n${selectors.map(selector => `  ${selector}({{bbox}});`).join("\n")}\n)->.candidates;
(
  node.candidates;
  way.candidates(if:count_members() <= ${GEOGRAPHY_MAX_WAY_NODES});
  rel.candidates(if:count_members() <= ${GEOGRAPHY_MAX_RELATION_MEMBERS});
);
out geom;
way.candidates(if:count_members() > ${GEOGRAPHY_MAX_WAY_NODES});
convert oversized_way ::id=id(), name=t["name"], memberCount=count_members();
out;
rel.candidates(if:count_members() > ${GEOGRAPHY_MAX_RELATION_MEMBERS});
convert oversized_relation ::id=id(), name=t["name"], memberCount=count_members();
out;`;
}

const assets = new Map<string, Promise<FeatureCollection>>();
async function naturalEarth(bbox: BBox, zoom: number, buckets = ["roads", "water", "waterways", "urban", "coastline", "ocean", "land"]): Promise<GeographyWays> {
  const entries = await Promise.all(buckets.map(async bucket => {
    let pending = assets.get(bucket);
    if (!pending) {
      pending = fs.readFile(new URL(`../../assets/geography/${bucket}.geojson.gz`, import.meta.url))
        .then(buffer => JSON.parse(gunzipSync(buffer).toString()) as FeatureCollection);
      assets.set(bucket, pending);
      pending.catch(() => assets.delete(bucket));
    }
    const data = await pending;
    return [bucket, { type: "FeatureCollection", features: data.features.filter(feature => {
      const b = feature.bbox!;
      return b[0] <= bbox[2] && b[2] >= bbox[0] && b[1] <= bbox[3] && b[3] >= bbox[1]
        && (bucket === "urban" || bucket === "coastline" || Number(feature.properties?.minZoom ?? 0) <= zoom + 1);
    }) }] as const;
  }));
  return Object.fromEntries(entries);
}

/** River polygons are filled water, but belong to the Rivers control. */
function separateRiverAreas(ways: GeographyWays): GeographyWays {
  const riverAreas: Feature[] = [];
  const separate = (key: "water" | "waterways") => {
    const bucket = ways[key];
    if (!bucket) return;
    bucket.features = bucket.features.filter(feature => {
      if (isAreaFeature(feature) && ["river", "stream", "canal"].includes(waterClass(feature))) {
        riverAreas.push(feature);
        return false;
      }
      return true;
    });
  };
  separate("water");
  separate("waterways");
  return { ...ways, riverAreas: { type: "FeatureCollection", features: riverAreas } };
}

/** Keep clipped ocean areas separate from lakes and rivers. */
function separateOceanAreas(ways: GeographyWays): GeographyWays {
  const water = ways.water;
  if (!water) return ways;
  const ocean = ways.ocean ?? { type: "FeatureCollection" as const, features: [] };
  water.features = water.features.filter(feature => {
    if (feature.properties?.geographyClass === "ocean") {
      ocean.features.push(feature);
      return false;
    }
    return true;
  });
  return { ...ways, ocean };
}

/** Reject malformed/unbounded input before any network access or grid allocation. */
export function parseGeographyBbox(raw: unknown): BBox {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(n => typeof n === "number" && Number.isFinite(n))
    || raw[0] < -180 || raw[2] > 180 || raw[1] < -85.05112878 || raw[3] > 85.05112878
    || raw[0] >= raw[2] || raw[1] >= raw[3]) throw new Error("Invalid geography frame");
  return raw as BBox;
}

export async function loadGeography(bbox: BBox, aspect: string, mode: GeographyMode = "auto", savedSceneId?: string, options: { route?: [number, number][]; detailScope?: GeographyDetailScope; routeDetail?: boolean; sceneDir?: string; query?: typeof queryOverpass } = {}): Promise<GeographyScene> {
  return geographyTiming.run(newGeographyTiming(), async () => {
    const started = performance.now();
    logGeographyTiming("start", { mode, aspect });
    try {
      const scene = await loadGeographyScene(bbox, aspect, mode, savedSceneId, options);
      logGeographyTiming("complete", { totalMs: performance.now() - started, mode,
        source: scene.source, profile: scene.profile, completeness: scene.completeness,
        warningCount: scene.warnings.length, queryResponseBytes: scene.queryResponseBytes,
        sceneId: scene.sceneId });
      return scene;
    } catch (error) {
      logGeographyTiming("failed", { totalMs: performance.now() - started, mode,
        errorType: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  });
}

async function loadGeographyScene(bbox: BBox, aspect: string, mode: GeographyMode, savedSceneId: string | undefined, options: Parameters<typeof loadGeography>[4] = {}): Promise<GeographyScene> {
  parseGeographyBbox(bbox);
  const detailScope = options.detailScope ?? (options.routeDetail === true ? "route" : "none");
  const requestKey = JSON.stringify([bbox, aspect, mode, detailScope === "route" ? options.route ?? [] : [], detailScope]);
  const userId = accountContext.getStore();
  if (userId) assertSafeUserId(userId);
  const sceneDir = options.sceneDir ?? path.join(OSM_CACHE_DIR, "scenes", ...(userId ? [userId] : []));
  const warnings: string[] = [];
  const sceneReadStarted = performance.now();
  if (savedSceneId && /^[a-f0-9]{64}$/.test(savedSceneId)) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(sceneDir, `${savedSceneId}.json`), "utf8"));
      if (saved.requestKey === requestKey && saved.scene?.policyVersion === GEOGRAPHY_VERSION
        && (saved.scene.source !== "overpass" || Number.isFinite(saved.scene.queryResponseBytes))) {
        logGeographyTiming("scene-cache", { status: "hit", ms: performance.now() - sceneReadStarted });
        return { ...saved.scene, sceneId: savedSceneId };
      }
    } catch { warnings.push("Saved map data is unavailable; geography has been refreshed."); }
  }
  logGeographyTiming("scene-cache", { status: savedSceneId ? "miss" : "not-requested", ms: performance.now() - sceneReadStarted });
  const sourceStarted = performance.now();
  const policy = geographyPolicy(bbox, aspect);
  const latitude = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  // Fetch the aspect-fitted poster window, including its margin, rather than just the route box.
  bbox = [Math.max(-180, policy.x0 * 360 - 180), Math.max(-85.05112878, latitude(policy.y1)),
    Math.min(180, policy.x1 * 360 - 180), Math.min(85.05112878, latitude(policy.y0))];
  let source: GeographyScene["source"] = "overpass";
  let completeness: GeographyScene["completeness"] = "complete";
  const queryStats: OverpassQueryStats = { responseBytes: 0 };
  let ways: GeographyWays;
  // Global budget is evaluated before Overpass constructs a tile grid.
  const latKm = (bbox[3] - bbox[1]) * 111.32;
  const lngKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos(Math.min(Math.abs(bbox[1]), Math.abs(bbox[3])) * Math.PI / 180);
  const tooManyTiles = Math.ceil(latKm / 35) * Math.ceil(lngKm / 35) > 32;
  const zoom = Math.log2(policy.width / (policy.x1 - policy.x0) / 512);
  if (mode === "auto" && (policy.metersPerPixel >= 100 || tooManyTiles)) {
    source = "natural-earth";
    completeness = "generalized";
    ways = await naturalEarth(bbox, zoom);
  } else {
    const features = FEATURE_CATALOG.filter(f => f.group === "geography");
    const selectors = mode === "manual" ? features.flatMap(f => f.selectors)
      : geographySelectors(policy.profile);
    const previousWarnings = warnings.length;
    let raw: FeatureCollection;
    try {
      raw = await (options.query ?? queryOverpass)(geographyQuery(selectors), bbox, warnings,
        mode === "manual" ? "manual geography" : "automatic geography", undefined,
        { maxTiles: mode === "manual" ? 64 : 32, timeoutMs: 90_000, maxBytes: 256 * 1024 * 1024, queryTimeoutS: 25 }, queryStats);
      if (queryStats.responseBytes === 0 && warnings.length === previousWarnings) {
        queryStats.responseBytes = Buffer.byteLength(JSON.stringify(raw));
      }
    } catch (error) {
      warnings.push(`Overpass geography failed: ${error instanceof Error ? error.message : String(error)}`);
      raw = emptyCollection();
    }
    ways = splitWays(raw, features);
    if (warnings.length > previousWarnings) {
      if (mode === "manual") throw new Error(`OpenStreetMap could not cover this poster frame: ${warnings.slice(previousWarnings).join("; ")}. Try a smaller frame or retry.`);
      source = "natural-earth";
      completeness = "fallback";
      ways = await naturalEarth(bbox, zoom);
      warnings.push("Detailed geography is unavailable. A generalized map is shown; small local features may be absent.");
    }
  }
  logGeographyTiming("source", { source, ms: performance.now() - sourceStarted });
  const processingStarted = performance.now();
  const omittedElements = queryStats.omittedElements ?? [];
  if (source === "overpass" && omittedElements.length) {
    completeness = "partial";
    const examples = omittedElements.slice(0, 3).map(element =>
      `${element.name ?? `${element.type}/${element.id}`} (${element.memberCount.toLocaleString("en-US")} ${element.type === "way" ? "nodes" : "members"})`);
    warnings.push(`${omittedElements.length} oversized map ${omittedElements.length === 1 ? "object was" : "objects were"} omitted: ${examples.join(", ")}${omittedElements.length > 3 ? ", …" : ""}. Other detailed geography is shown.`);
  }
  // At regional OSM detail, a clipped collection of coastline ways can form a
  // false ocean polygon covering the whole frame. Use explicit generalized
  // land/ocean polygons as the base beneath the detailed OSM features instead.
  const regionalOsmBase = mode === "auto" && source === "overpass" && policy.metersPerPixel >= 50;
  if (regionalOsmBase) ways = { ...ways, ...await naturalEarth(bbox, zoom, ["land", "ocean"]) };
  // Full polygon clipping preserves lakes containing the entire frame.
  const clipped = clipWaysToQueryFrame(ways, bbox, 0, source === "overpass" && policy.metersPerPixel < 50) as GeographyWays;
  let separated = separateOceanAreas(separateRiverAreas(clipped));
  // Incomplete OSM shores cannot safely establish a water side. Keep the
  // detailed shoreline, but supply an explicit ocean polygon instead of
  // leaving coastal scenes (such as Galloping Goose) without any ocean fill.
  const coastalFallback = source === "overpass" && !regionalOsmBase
    && Boolean(separated.coastline?.features.length) && !separated.ocean?.features.length;
  if (coastalFallback) {
    const base = await naturalEarth(bbox, zoom, ["ocean"]);
    separated = { ...separated, ...clipWaysToQueryFrame(base, bbox, 0, false) };
  }
  const resolved = mode === "auto" ? resolveGeographyScene(separated, policy, options.route, detailScope) : separated;
  const scene: GeographyScene = { bbox, ways: resolved, featureIds: visibleGeographyIds(resolved, Object.keys(GEOGRAPHY_BUCKETS)),
    policyVersion: policy.version, profile: policy.profile, metersPerPixel: policy.metersPerPixel,
    source, sourceVersion: source === "natural-earth" ? "scenic-ne-2"
      : regionalOsmBase || coastalFallback ? "osm-query-cache-7d+scenic-ne-2-base" : "osm-query-cache-7d",
    completeness, warnings, ...(omittedElements.length ? { omittedElements } : {}), ...(queryStats.responseBytes > 0 ? { queryResponseBytes: queryStats.responseBytes } : {}) };
  const encoded = JSON.stringify({ requestKey, scene });
  const sceneId = createHash("sha256").update(encoded).digest("hex");
  logGeographyTiming("processing", { ms: performance.now() - processingStarted });
  const writeStarted = performance.now();
  await fs.mkdir(sceneDir, { recursive: true });
  await fs.writeFile(path.join(sceneDir, `${sceneId}.json`), encoded);
  logGeographyTiming("scene-write", { ms: performance.now() - writeStarted, bytes: Buffer.byteLength(encoded) });
  return { ...scene, sceneId };
}
