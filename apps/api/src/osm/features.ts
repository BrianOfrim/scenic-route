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
  schematicXY,
  simplifyTrack,
  type BBox,
  type LatLng,
} from "../geo";
import { formatDate, formatDuration, formatElevation, formatKm, formatSpeed } from "../format";
import { KIND_WEIGHTS, resolveFeatures, type FeatureDef } from "./catalog";
import { collection, emptyCollection, queryOverpass, unionQuery } from "./overpass";

const MAX_POIS = 25;
const AMENITY_KINDS = new Set(["cafe", "pub", "restaurant", "place_of_worship", "playground"]);

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
] as const;

export async function loadRouteFeatures(activityId: number, featureIds?: string[]): Promise<PosterContext> {
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new Error("activityId is required");
  }
  const row = getActivity(activityId);
  if (!row) throw new Error(`activity ${activityId} not found`);
  const latlng = parseLatLng(row.latlng);
  if (latlng.length < 2) throw new Error(`activity ${activityId} has no GPS track`);
  const stops = findStopIndexes(latlng, parseNumberArray(row.time), parseNumberArray(row.velocity));
  const simplified = simplifyTrack(latlng, 1200, stops);

  const features = resolveFeatures(featureIds);
  const trackBbox = bboxFromLatLng(latlng);
  const trackDiagonal = bboxDiagonal(trackBbox);
  const padM = padMeters(trackDiagonal);
  const padded = padBbox(trackBbox, padM);
  const loop = isLoop(latlng, trackDiagonal);
  const warnings: string[] = [];

  const geoFeatures = features.filter((item) => item.group === "geography");
  const poiFeatures = features.filter((item) => item.group === "landmarks");

  const [waysFc, poisFc] = await Promise.all([
    geoFeatures.length
      ? queryOverpass(unionQuery(geoFeatures.flatMap((item) => item.selectors)), padded, warnings, "ways")
      : Promise.resolve(emptyCollection()),
    poiFeatures.length
      ? queryOverpass(unionQuery(poiFeatures.flatMap((item) => item.selectors)), padded, warnings, "landmarks")
      : Promise.resolve(emptyCollection()),
  ]);

  const ways = splitWays(waysFc, geoFeatures);
  const pois = rankPois(poisFc, latlng, padded, poiFeatures);
  const startPlace = nearestPlace(pois, latlng[0]);
  const finishPlace = nearestPlace(pois, latlng[latlng.length - 1]);

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
    pois,
    stats: buildStats(row, startPlace, finishPlace),
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

export function rankPois(
  geojson: FeatureCollection,
  latlng: LatLng[],
  bbox: BBox,
  selected: FeatureDef[],
): PosterPoi[] {
  const amenityMax = Math.min(...selected.map((item) => item.amenityMaxM ?? Number.POSITIVE_INFINITY));
  const center = centroid(latlng);
  const ranked: Array<PosterPoi & { score: number }> = [];
  const seen = new Set<string>();
  for (const feature of geojson.features) {
    const name = featureName(feature);
    if (!name) continue;
    const point = featurePoint(feature);
    if (!point) continue;
    const [lat, lng] = point;
    const kind = classifyPoi(featureTags(feature));
    const { distM, routeFrac } = nearestOnRoute(lat, lng, latlng);
    if (AMENITY_KINDS.has(kind) && Number.isFinite(amenityMax) && distM > amenityMax) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const xy = schematicXY(lat, lng, bbox);
    ranked.push({
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
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_POIS).map(({ score: _score, ...row }) => row);
}

export function classifyPoi(tags: Record<string, string>): string {
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

function flattenCoords(coords: unknown): number[][] {
  if (!Array.isArray(coords) || !coords.length) return [];
  if (typeof coords[0] === "number" && coords.length >= 2) {
    return [[Number(coords[0]), Number(coords[1])]];
  }
  return (coords as unknown[]).flatMap((item) => flattenCoords(item));
}

function avg(values: number[]) {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function nearestPlace(pois: PosterPoi[], point: LatLng): string {
  const places = pois.filter((poi) =>
    ["city", "town", "village", "hamlet", "suburb", "locality"].includes(poi.kind),
  );
  if (!places.length) return "";
  let best = places[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const poi of places) {
    const d = (poi.lat - point[0]) ** 2 + (poi.lng - point[1]) ** 2;
    if (d < bestDist) {
      best = poi;
      bestDist = d;
    }
  }
  return best.name;
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
  startPlace: string,
  finishPlace: string,
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
  if (startPlace) stats.push({ id: "startPlace", label: "Start", value: startPlace });
  if (finishPlace) stats.push({ id: "finishPlace", label: "Finish", value: finishPlace });
  return stats.filter((item) => item.value);
}
