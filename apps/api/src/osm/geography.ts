import { createHash } from "node:crypto";
import path from "node:path";
import { OSM_CACHE_DIR } from "../paths";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { FeatureCollection } from "geojson";
import type { BBox } from "../geo";
import { FEATURE_CATALOG } from "./catalog";
import { splitWays } from "./features";
import { clipWaysToQueryFrame } from "./geoExtent";
import { queryOverpass, unionQuery } from "./overpass";
import { GEOGRAPHY_BUCKETS, geographyPolicy, geographySelectors, resolveGeographyScene, visibleGeographyIds, type GeographyMode, type GeographyWays, type GeographyScene } from "./geographyPolicy";

export type { GeographyScene } from "./geographyPolicy";

const assets = new Map<string, Promise<FeatureCollection>>();
async function naturalEarth(bbox: BBox, zoom: number): Promise<GeographyWays> {
  const entries = await Promise.all(["roads", "water", "waterways", "urban", "coastline", "ocean"].map(async bucket => {
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
  const ways = Object.fromEntries(entries);
  ways.water.features.push(...ways.ocean.features);
  delete ways.ocean;
  return ways;
}

/** Reject malformed/unbounded input before any network access or grid allocation. */
export function parseGeographyBbox(raw: unknown): BBox {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(n => typeof n === "number" && Number.isFinite(n))
    || raw[0] < -180 || raw[2] > 180 || raw[1] < -85.05112878 || raw[3] > 85.05112878
    || raw[0] >= raw[2] || raw[1] >= raw[3]) throw new Error("Invalid geography frame");
  return raw as BBox;
}

export async function loadGeography(bbox: BBox, aspect: string, mode: GeographyMode = "auto", savedSceneId?: string, options: { route?: [number, number][]; sceneDir?: string; query?: typeof queryOverpass } = {}): Promise<GeographyScene> {
  parseGeographyBbox(bbox);
  const requestKey = JSON.stringify([bbox, aspect, mode, options.route ?? []]);
  const sceneDir = options.sceneDir ?? path.join(OSM_CACHE_DIR, "scenes");
  const warnings: string[] = [];
  if (savedSceneId && /^[a-f0-9]{64}$/.test(savedSceneId)) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(sceneDir, `${savedSceneId}.json`), "utf8"));
      if (saved.requestKey === requestKey) return { ...saved.scene, sceneId: savedSceneId };
    } catch { warnings.push("Saved map data is unavailable; geography has been refreshed."); }
  }
  const policy = geographyPolicy(bbox, aspect);
  const latitude = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  // Fetch the aspect-fitted poster window, including its margin, rather than just the route box.
  bbox = [Math.max(-180, policy.x0 * 360 - 180), Math.max(-85.05112878, latitude(policy.y1)),
    Math.min(180, policy.x1 * 360 - 180), Math.min(85.05112878, latitude(policy.y0))];
  let source: GeographyScene["source"] = "overpass";
  let completeness: GeographyScene["completeness"] = "complete";
  let ways: GeographyWays;
  // Global budget is evaluated before Overpass constructs a tile grid.
  const latKm = (bbox[3] - bbox[1]) * 111.32;
  const lngKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos(Math.min(Math.abs(bbox[1]), Math.abs(bbox[3])) * Math.PI / 180);
  const tooManyTiles = Math.ceil(latKm / 35) * Math.ceil(lngKm / 35) > 8;
  const zoom = Math.log2(policy.width / (policy.x1 - policy.x0) / 512);
  if (policy.profile === "regional" || policy.profile === "wide" || tooManyTiles) {
    source = "natural-earth";
    completeness = "generalized";
    ways = await naturalEarth(bbox, zoom);
  } else {
    const features = FEATURE_CATALOG.filter(f => f.group === "geography");
    const selectors = mode === "manual" ? features.flatMap(f => f.selectors) : geographySelectors(policy.profile);
    const previousWarnings = warnings.length;
    const raw = await (options.query ?? queryOverpass)(unionQuery(selectors), bbox, warnings, "automatic geography", undefined, { maxTiles: 8, timeoutMs: 90_000, maxBytes: 48 * 1024 * 1024, queryTimeoutS: 25 });
    ways = splitWays(raw, features);
    if (warnings.length > previousWarnings) {
      source = "natural-earth";
      completeness = "fallback";
      ways = await naturalEarth(bbox, zoom);
      warnings.push("Detailed geography is unavailable. A generalized map is shown; small local features may be absent.");
    }
  }
  // Full polygon clipping preserves lakes containing the entire frame.
  const clipped = clipWaysToQueryFrame(ways, bbox, 0, source !== "natural-earth") as GeographyWays;
  const resolved = mode === "auto" ? resolveGeographyScene(clipped, policy, options.route) : clipped;
  const scene: GeographyScene = { bbox, ways: resolved, featureIds: visibleGeographyIds(resolved, Object.keys(GEOGRAPHY_BUCKETS)),
    policyVersion: policy.version, profile: policy.profile, metersPerPixel: policy.metersPerPixel,
    source, sourceVersion: source === "natural-earth" ? "scenic-ne-1" : "osm-query-cache-7d",
    completeness, warnings };
  const encoded = JSON.stringify({ requestKey, scene });
  const sceneId = createHash("sha256").update(encoded).digest("hex");
  await fs.mkdir(sceneDir, { recursive: true });
  await fs.writeFile(path.join(sceneDir, `${sceneId}.json`), encoded);
  return { ...scene, sceneId };
}
