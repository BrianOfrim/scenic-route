import type { Feature, FeatureCollection, Geometry } from "geojson";
import { getActivity, parseLatLng, parseNumberArray } from "../activities";
import {
  bboxDiagonal,
  bboxFromLatLng,
  bboxToCorners,
  bearingWord,
  centroid,
  findStopIndexes,
  isLoop,
  nearestOnRoute,
  padBbox,
  padMeters,
  remapRouteSpans,
  schematicXY,
  simplifyTrack,
  type BBox,
  type LatLng,
} from "../geo";
import { formatDate, formatDuration, formatElevation, formatKm, formatSpeed } from "../format";
import { loadActivitySegmentEfforts } from "../stravaSegments";
import type { StravaSegmentEffort } from "../strava";
import { KIND_WEIGHTS, nearRouteMForKind, resolveFeatures, type FeatureDef } from "./catalog";
import { collection, emptyCollection, queryOverpass, unionQuery } from "./overpass";

const MIN_STRAVA_SEGMENT_M = 200;

const MAX_POIS = 25;
const MAX_NAMED_WAYS = 16;
const MAX_NAMED_AREAS = 3;
const MAX_LINE_POINTS = 80;
const AREA_MAX_OCCUPANCY = 0.45;
const AREA_MIN_OCCUPANCY = 0.01;
const AREA_ON_GROUNDS_M = 1500;
const AREA_SPECIFICITY: Record<string, number> = {
  university: 3,
  college: 3,
  school: 2,
  park: 2,
  nature_reserve: 2,
  neighbourhood: 1,
  quarter: 1,
};
const SPECIAL_BUCKETS = new Set(["poi", "named-ways", "strava-ways", "named-areas"]);

export type PosterPoi = {
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  source?: string;
  /** Most specific named region containing this point, if any. */
  inside?: string;
};

export type AreaGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type NamedArea = {
  name: string;
  kind: string;
  geometry: AreaGeometry;
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  /** Schematic wash letter (A, B, C…). Names live in the prompt. */
  letter?: string;
};

export type NamedWay = {
  name: string;
  kind: string;
  geometry: { type: "MultiLineString"; coordinates: number[][][] };
  lat: number;
  lng: number;
  distToRouteM: number;
  routeFrac: number;
  bearing: string;
  xy: { x: number; y: number; region: string };
  source?: "osm" | "strava" | "user";
  colorName?: string;
  color?: string;
  /** Inclusive GPS-stream indexes from Strava efforts. Prefer these over distance. */
  routeSpans?: Array<{ start: number; end: number }>;
};

export type PosterWays = Record<string, FeatureCollection>;

export type FormattedStat = {
  id: string;
  label: string;
  value: string;
};

export type PosterContext = {
  activity: {
    id: number;
    name: string;
    sportType: string;
    startDate: string;
    distance: number;
    movingTime: number | null;
    elapsedTime: number | null;
    elevationGain: number | null;
    averageSpeed: number | null;
    isLoop: boolean;
    start: { lat: number; lng: number };
    finish: { lat: number; lng: number };
  };
  bbox: [[number, number], [number, number]];
  latlng: LatLng[];
  stops: number[];
  ways: PosterWays;
  namedWays: NamedWay[];
  namedAreas: NamedArea[];
  pois: PosterPoi[];
  stats: FormattedStat[];
  warnings: string[];
  featureIds: string[];
};

const WAY_BUCKETS = [
  "roads",
  "streets",
  "paths",
  "rail",
  "water",
  "waterways",
  "forest",
  "parks",
  "farmland",
  "cemeteries",
] as const;

export async function loadRouteFeatures(
  activityId: number,
  featureIds?: string[],
  nearRouteM?: Record<string, number>,
): Promise<PosterContext> {
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new Error("activityId is required");
  }
  const row = getActivity(activityId);
  if (!row) throw new Error(`activity ${activityId} not found`);
  const latlng = parseLatLng(row.latlng);
  if (latlng.length < 2) throw new Error(`activity ${activityId} has no GPS track`);
  const stops = findStopIndexes(latlng, parseNumberArray(row.time), parseNumberArray(row.velocity));
  const simplified = simplifyTrack(latlng, 1200, stops);

  const features = resolveFeatures(featureIds, nearRouteM);
  const trackBbox = bboxFromLatLng(latlng);
  const trackDiagonal = bboxDiagonal(trackBbox);
  const padM = padMeters(trackDiagonal);
  const padded = padBbox(trackBbox, padM);
  const loop = isLoop(latlng, trackDiagonal);
  const warnings: string[] = [];

  const geoFeatures = features.filter((item) => !SPECIAL_BUCKETS.has(item.bucket));
  const poiFeatures = features.filter((item) => item.bucket === "poi");
  const namedAreaFeatures = features.filter((item) => item.bucket === "named-areas");
  const wantStravaWays = features.some((item) => item.bucket === "strava-ways");

  const [waysFc, poisFc, namedAreaFc, stravaEfforts] = await Promise.all([
    geoFeatures.length
      ? queryOverpass(unionQuery(geoFeatures.flatMap((item) => item.selectors)), padded, warnings, "ways")
      : Promise.resolve(emptyCollection()),
    poiFeatures.length
      ? queryOverpass(unionQuery(poiFeatures.flatMap((item) => item.selectors), "center"), padded, warnings, "landmarks")
      : Promise.resolve(emptyCollection()),
    namedAreaFeatures.length
      ? queryOverpass(unionQuery(namedAreaFeatures.flatMap((item) => item.selectors)), padded, warnings, "named areas")
      : Promise.resolve(emptyCollection()),
    wantStravaWays ? loadActivitySegmentEfforts(activityId, warnings) : Promise.resolve([]),
  ]);

  const ways = splitWays(waysFc, geoFeatures);
  const cemetery = features.find((item) => item.id === "cemeteries");
  const { areas: namedAreas, fallbacks: areaFallbacks } = collectNamedAreas(
    namedAreaFc,
    latlng,
    padded,
    namedAreaFeatures,
  );
  const namedWater = features.some((item) => item.id === "named-water") ? namedWaterFeatures(ways) : [];
  const pois = dropPoiNames(
    annotatePoisInsideAreas(
      rankPois(
        {
          type: "FeatureCollection",
          features: [
            ...poisFc.features,
            ...namedWater,
            ...(ways.cemeteries?.features ?? []),
            ...areaFallbacks,
          ],
        },
        latlng,
        padded,
        cemetery ? [...poiFeatures, cemetery, ...namedAreaFeatures] : [...poiFeatures, ...namedAreaFeatures],
      ),
      namedAreas,
    ),
    namedAreas,
  );
  return {
    activity: {
      id: row.id,
      name: row.name,
      sportType: row.sport_type,
      startDate: row.start_date,
      distance: row.distance,
      movingTime: row.moving_time,
      elapsedTime: row.elapsed_time,
      elevationGain: row.total_elevation_gain,
      averageSpeed: row.average_speed,
      isLoop: loop,
      start: { lat: latlng[0][0], lng: latlng[0][1] },
      finish: { lat: latlng[latlng.length - 1][0], lng: latlng[latlng.length - 1][1] },
    },
    bbox: bboxToCorners(padded),
    latlng: simplified.points,
    stops: simplified.kept,
    ways,
    namedWays: namedWaysFromSegmentEfforts(stravaEfforts, latlng, padded, features).map((way) => ({
      ...way,
      routeSpans: remapRouteSpans(way.routeSpans, simplified.indexes),
    })),
    namedAreas,
    pois,
    stats: buildStats(row),
    warnings,
    featureIds: features.map((item) => item.id),
  };
}

export function splitWays(geojson: FeatureCollection, selected: FeatureDef[]): PosterWays {
  const buckets: Record<string, Feature[]> = Object.fromEntries(WAY_BUCKETS.map((key) => [key, []]));
  const selectedBuckets = new Set(selected.map((item) => item.bucket));
  for (const feature of geojson.features) {
    const tags = featureTags(feature);
    const geom = feature.geometry?.type;
    let bucket: string | null = null;
    if (tags.highway) {
      if (/^(motorway|trunk|primary|secondary)/.test(tags.highway)) bucket = "roads";
      else if (/^(cycleway|track|footway|path|bridleway|pedestrian)$/.test(tags.highway)) bucket = "paths";
      else bucket = "streets";
    } else if (tags.railway) bucket = "rail";
    else if (tags.waterway) bucket = "waterways";
    else if (tags.natural === "water" || tags.water) bucket = "water";
    else if (tags.landuse === "forest" || tags.natural === "wood") bucket = "forest";
    else if (tags.leisure === "park" || tags.leisure === "nature_reserve" || tags.leisure === "garden" || tags.landuse === "recreation_ground") {
      bucket = "parks";
    } else if (/^(farmland|meadow|orchard|vineyard)$/.test(tags.landuse ?? "")) {
      bucket = "farmland";
    } else if (tags.landuse === "cemetery" || tags.amenity === "grave_yard") {
      bucket = "cemeteries";
    } else if (geom === "Polygon" || geom === "MultiPolygon") {
      bucket = "forest";
    } else if (geom === "LineString" || geom === "MultiLineString") {
      bucket = "waterways";
    }
    if (!bucket || !selectedBuckets.has(bucket)) continue;
    const extra =
      tags.highway && bucket === "roads"
        ? { ...feature, properties: { ...(feature.properties ?? {}), class: tags.highway } }
        : feature;
    buckets[bucket].push(extra);
  }
  return Object.fromEntries(WAY_BUCKETS.map((key) => [key, collection(buckets[key])]));
}

/** Named lake polygons from geography, so ranking can use the shoreline instead of the centroid. */
export function namedWaterFeatures(ways: PosterWays): Feature[] {
  return (ways.water?.features ?? []).filter((feature) => {
    if (!featureName(feature)) return false;
    return Boolean(asAreaGeometry(feature.geometry));
  });
}

export function rankPois(
  geojson: FeatureCollection,
  latlng: LatLng[],
  bbox: BBox,
  selected: FeatureDef[],
): PosterPoi[] {
  const center = centroid(latlng);
  const ranked = new Map<string, PosterPoi & { score: number }>();
  for (const feature of geojson.features) {
    const name = featureName(feature);
    if (!name) continue;
    const point = featurePoint(feature);
    if (!point) continue;
    const kind = classifyPoi(featureTags(feature));
    const hit = poiRouteHit(feature, point[0], point[1], latlng);
    if (!isAlongRoute(hit.distM, kind, selected)) continue;
    const key = name.toLowerCase();
    const existing = ranked.get(key);
    if (existing && hit.distM >= existing.distToRouteM) continue;
    const { lat, lng, distM, routeFrac } = hit;
    const xy = schematicXY(lat, lng, bbox);
    ranked.set(key, {
      name,
      kind,
      lat,
      lng,
      distToRouteM: Math.round(distM * 10) / 10,
      routeFrac: Math.round(routeFrac * 10_000) / 10_000,
      bearing: bearingWord(center, [lat, lng]),
      xy,
      score: (KIND_WEIGHTS[kind] ?? 20) - distM / 50,
    });
  }
  return [...ranked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_POIS)
    .map(({ score: _score, ...row }) => row);
}

export function namedWaysFromSegmentEfforts(
  efforts: StravaSegmentEffort[],
  latlng: LatLng[],
  bbox: BBox,
  selected: FeatureDef[] = [],
): NamedWay[] {
  const features = [];
  for (const effort of efforts) {
    if (effort.hidden) continue;
    if ((effort.distance ?? 0) < MIN_STRAVA_SEGMENT_M) continue;
    const name = (effort.segment?.name || effort.name || "").trim();
    if (!name) continue;
    const start = Math.max(0, Math.min(effort.start_index ?? -1, effort.end_index ?? -1));
    const end = Math.min(latlng.length - 1, Math.max(effort.start_index ?? -1, effort.end_index ?? -1));
    if (end <= start) continue;
    const coordinates = latlng.slice(start, end + 1).map(([lat, lng]) => [lng, lat]);
    if (coordinates.length < 2) continue;
    features.push({
      type: "Feature" as const,
      properties: { name, tags: { highway: "path", name }, routeStart: start, routeEnd: end },
      geometry: { type: "LineString" as const, coordinates },
    });
  }
  return collectNamedWays(collection(features), latlng, bbox, "strava", selected);
}

export function collectNamedWays(
  geojson: FeatureCollection,
  latlng: LatLng[],
  bbox: BBox,
  source: NamedWay["source"] = "osm",
  selected: FeatureDef[] = [],
): NamedWay[] {
  const groups = new Map<
    string,
    { name: string; kind: string; lines: number[][][]; spans: Array<{ start: number; end: number }> }
  >();
  for (const feature of geojson.features) {
    const name = featureName(feature);
    if (!name) continue;
    const lines = lineCoords(feature.geometry);
    if (!lines.length) continue;
    const key = name.toLowerCase();
    const kind = classifyPoi(featureTags(feature));
    const span = featureRouteSpan(feature);
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(...lines);
      if (span) existing.spans.push(span);
    } else {
      groups.set(key, { name, kind, lines, spans: span ? [span] : [] });
    }
  }
  const center = centroid(latlng);
  const ranked: Array<NamedWay & { score: number }> = [];
  for (const group of groups.values()) {
    const simplified = group.lines
      .map((line) => simplifyCoords(line, MAX_LINE_POINTS))
      .filter((line) => line.length >= 2);
    if (!simplified.length) continue;
    const anchor = closestOnLines(simplified, latlng);
    if (!anchor || !isAlongRoute(anchor.distM, group.kind, selected)) continue;
    ranked.push({
      name: group.name,
      kind: group.kind,
      geometry: { type: "MultiLineString", coordinates: simplified },
      lat: anchor.lat,
      lng: anchor.lng,
      distToRouteM: Math.round(anchor.distM * 10) / 10,
      routeFrac: Math.round(anchor.routeFrac * 10_000) / 10_000,
      bearing: bearingWord(center, [anchor.lat, anchor.lng]),
      xy: schematicXY(anchor.lat, anchor.lng, bbox),
      source,
      routeSpans: group.spans.length ? mergeRouteSpans(group.spans) : undefined,
      score: (KIND_WEIGHTS[group.kind] ?? 20) - anchor.distM / 50,
    });
  }
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NAMED_WAYS)
    .map(({ score: _score, ...row }) => row);
}

export function mergeNamedWays(...lists: NamedWay[][]): NamedWay[] {
  const byName = new Map<string, NamedWay>();
  for (const list of lists) {
    for (const way of list) {
      const key = way.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...way, routeSpans: mergeRouteSpans(way.routeSpans) });
        continue;
      }
      const routeSpans = mergeRouteSpans(existing.routeSpans, way.routeSpans);
      if (sourceRank(way) < sourceRank(existing)) {
        byName.set(key, { ...way, routeSpans });
        continue;
      }
      if (sourceRank(way) === sourceRank(existing) && way.distToRouteM < existing.distToRouteM) {
        byName.set(key, { ...way, routeSpans });
        continue;
      }
      byName.set(key, { ...existing, routeSpans });
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.distToRouteM - b.distToRouteM)
    .slice(0, MAX_NAMED_WAYS);
}

function sourceRank(way: NamedWay): number {
  return way.source === "strava" ? 1 : 0;
}

export function collectNamedAreas(
  geojson: FeatureCollection,
  latlng: LatLng[],
  bbox: BBox,
  selected: FeatureDef[] = [],
): { areas: NamedArea[]; fallbacks: Feature[] } {
  const center = centroid(latlng);
  const ranked = new Map<string, NamedArea & { score: number }>();
  const fallbacks: Feature[] = [];
  for (const feature of geojson.features) {
    const name = featureName(feature);
    if (!name) continue;
    const kind = classifyPoi(featureTags(feature));
    const geometry = asAreaGeometry(feature.geometry);
    if (!geometry) {
      fallbacks.push(feature);
      continue;
    }
    const occupancy = areaOccupancy(geometry, bbox);
    if (occupancy == null || occupancy > AREA_MAX_OCCUPANCY) continue;
    if (occupancy < AREA_MIN_OCCUPANCY) {
      fallbacks.push(feature);
      continue;
    }
    const simplified = simplifyArea(geometry, MAX_LINE_POINTS);
    const anchor = closestOnArea(simplified, latlng);
    if (!anchor || !isAlongRoute(anchor.distM, kind, selected)) continue;
    const key = name.toLowerCase();
    const existing = ranked.get(key);
    if (existing && anchor.distM >= existing.distToRouteM) continue;
    ranked.set(key, {
      name,
      kind,
      geometry: simplified,
      lat: anchor.lat,
      lng: anchor.lng,
      distToRouteM: Math.round(anchor.distM * 10) / 10,
      routeFrac: Math.round(anchor.routeFrac * 10_000) / 10_000,
      bearing: bearingWord(center, [anchor.lat, anchor.lng]),
      xy: schematicXY(anchor.lat, anchor.lng, bbox),
      score: (KIND_WEIGHTS[kind] ?? 20) - anchor.distM / 50,
    });
  }
  const areas = pruneNestedAreas(
    [...ranked.values()]
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...row }) => row),
  ).slice(0, MAX_NAMED_AREAS);
  const kept = new Set(areas.map((area) => area.name.toLowerCase()));
  return {
    areas,
    fallbacks: fallbacks.filter((feature) => {
      const name = featureName(feature);
      return !name || !kept.has(name.toLowerCase());
    }),
  };
}

const SETTLEMENT_KINDS = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "locality",
]);

export function annotatePoisInsideAreas(pois: PosterPoi[], areas: NamedArea[]): PosterPoi[] {
  if (!areas.length) return pois;
  return pois.map((poi) => {
    if (SETTLEMENT_KINDS.has(poi.kind)) return poi;
    const containers = areas.filter(
      (area) =>
        area.name.toLowerCase() !== poi.name.toLowerCase() &&
        geometryContains(area.geometry, poi.lat, poi.lng),
    );
    if (!containers.length) return poi;
    containers.sort((a, b) => (AREA_SPECIFICITY[b.kind] ?? 0) - (AREA_SPECIFICITY[a.kind] ?? 0));
    return { ...poi, inside: containers[0].name };
  });
}

export function dropPoiNames(pois: PosterPoi[], areas: NamedArea[]): PosterPoi[] {
  if (!areas.length) return pois;
  const names = new Set(areas.map((area) => area.name.toLowerCase()));
  return pois.filter((poi) => !names.has(poi.name.toLowerCase()));
}

export function pruneNestedAreas(areas: NamedArea[]): NamedArea[] {
  if (areas.length < 2) return areas;
  const drop = new Set<NamedArea>();
  for (const inner of areas) {
    for (const outer of areas) {
      if (inner === outer || drop.has(inner) || drop.has(outer)) continue;
      if (!geometryContains(outer.geometry, inner.lat, inner.lng)) continue;
      const innerSpec = AREA_SPECIFICITY[inner.kind] ?? 0;
      const outerSpec = AREA_SPECIFICITY[outer.kind] ?? 0;
      if (innerSpec > outerSpec && inner.distToRouteM <= AREA_ON_GROUNDS_M) {
        drop.add(outer);
      } else {
        drop.add(inner);
      }
    }
  }
  return areas.filter((area) => !drop.has(area));
}

export function classifyPoi(tags: Record<string, string>): string {
  if (tags.landuse === "cemetery" || tags.amenity === "grave_yard") return "cemetery";
  if (/^(mtb|hiking|bicycle|foot)$/.test(tags.route ?? "")) return "trail";
  if (/^(path|track|cycleway|bridleway)$/.test(tags.highway ?? "")) return "trail";
  for (const key of ["natural", "waterway", "place", "tourism", "leisure", "man_made", "amenity"]) {
    const value = tags[key];
    if (value) return value;
  }
  if (tags.historic) return tags.historic === "yes" ? "historic" : tags.historic;
  return "feature";
}

export function featurePoint(feature: Feature): LatLng | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point") {
    return [geometry.coordinates[1], geometry.coordinates[0]];
  }
  const points = flattenCoords((geometry as Geometry & { coordinates: unknown }).coordinates);
  if (!points.length) return null;
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [avg(lats), avg(lngs)];
}

function featureTags(feature: Feature): Record<string, string> {
  const props = feature.properties ?? {};
  const tags = (props as { tags?: Record<string, string> }).tags;
  return tags ?? {};
}

function featureName(feature: Feature): string | null {
  const props = feature.properties ?? {};
  const name = (props as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function featureRouteSpan(feature: Feature): { start: number; end: number } | null {
  const props = feature.properties ?? {};
  const start = (props as { routeStart?: unknown }).routeStart;
  const end = (props as { routeEnd?: unknown }).routeEnd;
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function mergeRouteSpans(
  ...lists: Array<Array<{ start: number; end: number }> | undefined>
): Array<{ start: number; end: number }> | undefined {
  let seen = false;
  const all: Array<{ start: number; end: number }> = [];
  for (const list of lists) {
    if (list === undefined) continue;
    seen = true;
    all.push(...list);
  }
  if (!seen) return undefined;
  const normalized = all
    .map((span) => ({
      start: Math.min(span.start, span.end),
      end: Math.max(span.start, span.end),
    }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end >= span.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Array<{ start: number; end: number }> = [];
  for (const span of normalized) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end + 1) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    out.push({ ...span });
  }
  return out;
}

function lineCoords(geometry: Geometry | null): number[][][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function simplifyCoords(coords: number[][], maxPoints: number): number[][] {
  if (coords.length <= maxPoints) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => coords[Math.round(index * step)]);
}

function closestOnLines(
  lines: number[][][],
  latlng: LatLng[],
): { lat: number; lng: number; distM: number; routeFrac: number } | null {
  let best: { lat: number; lng: number; distM: number; routeFrac: number } | null = null;
  for (const line of lines) {
    for (const point of line) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [lng, lat] = point;
      const hit = nearestOnRoute(lat, lng, latlng);
      if (!best || hit.distM < best.distM) best = { lat, lng, ...hit };
    }
  }
  return best;
}

function flattenCoords(coords: unknown): number[][] {
  if (!Array.isArray(coords) || !coords.length) return [];
  if (typeof coords[0] === "number" && coords.length >= 2) {
    return [[Number(coords[0]), Number(coords[1])]];
  }
  return (coords as unknown[]).flatMap((item) => flattenCoords(item));
}

export function asAreaGeometry(geometry: Geometry | null | undefined): AreaGeometry | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return geometry;
  if (geometry.type === "MultiPolygon") return geometry;
  if (geometry.type === "LineString") {
    const ring = closedRing(geometry.coordinates);
    return ring ? { type: "Polygon", coordinates: [ring] } : null;
  }
  if (geometry.type === "MultiLineString") {
    const rings = geometry.coordinates.map(closedRing).filter((ring): ring is number[][] => Boolean(ring));
    if (rings.length === 1) return { type: "Polygon", coordinates: rings };
    if (rings.length > 1) return { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
    const joined = joinRing(geometry.coordinates);
    return joined ? { type: "Polygon", coordinates: [joined] } : null;
  }
  return null;
}

function closedRing(coords: number[][]): number[][] | null {
  if (coords.length < 4) return null;
  if (!nearCoord(coords[0], coords[coords.length - 1])) return null;
  return coords;
}

function joinRing(lines: number[][][]): number[][] | null {
  const remaining = lines.map((line) => line.filter((point) => point.length >= 2)).filter((line) => line.length >= 2);
  if (!remaining.length) return null;
  let ring = remaining.shift()!.slice();
  while (remaining.length) {
    const end = ring[ring.length - 1];
    const index = remaining.findIndex(
      (line) => nearCoord(line[0], end) || nearCoord(line[line.length - 1], end),
    );
    if (index < 0) break;
    const next = remaining.splice(index, 1)[0];
    const piece = nearCoord(next[0], end) ? next : next.slice().reverse();
    ring = ring.concat(piece.slice(1));
  }
  if (ring.length >= 4 && nearCoord(ring[0], ring[ring.length - 1])) return ring;
  return null;
}

function nearCoord(a: number[], b: number[], eps = 1e-7) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function simplifyArea(geometry: AreaGeometry, maxPoints: number): AreaGeometry {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => simplifyClosedRing(ring, maxPoints)) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => simplifyClosedRing(ring, maxPoints))),
  };
}

function simplifyClosedRing(coords: number[][], maxPoints: number): number[][] {
  if (coords.length <= maxPoints) return coords;
  const inner = coords[0] && nearCoord(coords[0], coords[coords.length - 1]) ? coords.slice(0, -1) : coords;
  const simplified = simplifyCoords(inner, Math.max(3, maxPoints - 1));
  return [...simplified, simplified[0]];
}

function areaOccupancy(geometry: AreaGeometry, bbox: BBox): number | null {
  const geomBbox = geometryBbox(geometry);
  if (!geomBbox) return null;
  const clipped = intersectBbox(geomBbox, bbox);
  if (!clipped) return null;
  const frame = Math.max(1e-12, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  return ((clipped[2] - clipped[0]) * (clipped[3] - clipped[1])) / frame;
}

function geometryBbox(geometry: AreaGeometry): BBox | null {
  const points = flattenCoords(geometry.coordinates);
  if (!points.length) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function intersectBbox(a: BBox, b: BBox): BBox | null {
  const minLng = Math.max(a[0], b[0]);
  const minLat = Math.max(a[1], b[1]);
  const maxLng = Math.min(a[2], b[2]);
  const maxLat = Math.min(a[3], b[3]);
  if (maxLng <= minLng || maxLat <= minLat) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function isAlongRoute(distM: number, kind?: string, selected: FeatureDef[] = []): boolean {
  return distM <= nearRouteMForKind(kind, selected);
}

function poiRouteHit(
  feature: Feature,
  lat: number,
  lng: number,
  latlng: LatLng[],
): { lat: number; lng: number; distM: number; routeFrac: number } {
  const area = asAreaGeometry(feature.geometry);
  if (area) {
    const anchor = closestOnArea(area, latlng);
    if (anchor) return anchor;
  }
  const hit = nearestOnRoute(lat, lng, latlng);
  return { lat, lng, ...hit };
}

function closestOnArea(
  geometry: AreaGeometry,
  latlng: LatLng[],
): { lat: number; lng: number; distM: number; routeFrac: number } | null {
  const contained = containedTrackAnchor(geometry, latlng);
  if (contained) return contained;
  const vertices = flattenCoords(geometry.coordinates);
  let best: { lat: number; lng: number; distM: number; routeFrac: number } | null = null;
  for (const point of vertices) {
    if (point.length < 2) continue;
    const [lng, lat] = point;
    const hit = nearestOnRoute(lat, lng, latlng);
    if (!best || hit.distM < best.distM) best = { lat, lng, ...hit };
  }
  return best;
}

/** Centroid of the GPS points that sit inside the polygon. */
function containedTrackAnchor(
  geometry: AreaGeometry,
  latlng: LatLng[],
): { lat: number; lng: number; distM: number; routeFrac: number } | null {
  const inside: LatLng[] = [];
  const indexes: number[] = [];
  for (let i = 0; i < latlng.length; i += 1) {
    if (!geometryContains(geometry, latlng[i][0], latlng[i][1])) continue;
    inside.push(latlng[i]);
    indexes.push(i);
  }
  if (!inside.length) return null;
  const lat = avg(inside.map((point) => point[0]));
  const lng = avg(inside.map((point) => point[1]));
  let nearest = indexes[0];
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < inside.length; i += 1) {
    const dLat = inside[i][0] - lat;
    const dLng = inside[i][1] - lng;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = indexes[i];
    }
  }
  return { lat, lng, distM: 0, routeFrac: nearest / Math.max(1, latlng.length - 1) };
}

export function geometryContains(geometry: AreaGeometry, lat: number, lng: number): boolean {
  if (geometry.type === "Polygon") return polygonContains(geometry.coordinates, lng, lat);
  return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
}

function polygonContains(rings: number[][][], lng: number, lat: number): boolean {
  if (!rings.length || !ringContains(rings[0], lng, lat)) return false;
  return !rings.slice(1).some((hole) => ringContains(hole, lng, lat));
}

function ringContains(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function avg(values: number[]) {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function buildStats(
  row: {
    name: string;
    sport_type: string;
    start_date: string;
    distance: number;
    moving_time: number | null;
    elapsed_time: number | null;
    total_elevation_gain: number | null;
    average_speed: number | null;
  },
): FormattedStat[] {
  const stats: FormattedStat[] = [
    { id: "title", label: "Title", value: row.name },
    { id: "date", label: "Date", value: formatDate(row.start_date) },
    { id: "sport", label: "Sport", value: row.sport_type },
    { id: "distance", label: "Distance", value: formatKm(row.distance) },
    { id: "movingTime", label: "Moving time", value: formatDuration(row.moving_time) },
    { id: "elapsedTime", label: "Elapsed time", value: formatDuration(row.elapsed_time) },
    { id: "elevationGain", label: "Elevation gain", value: formatElevation(row.total_elevation_gain) },
    { id: "averageSpeed", label: "Average speed", value: formatSpeed(row.average_speed) },
  ];
  return stats.filter((item) => item.value);
}
