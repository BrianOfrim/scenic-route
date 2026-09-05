import { getActivity, parseLatLng } from "../activities";
import {
  bboxDiagonal,
  bboxFromLatLng,
  bearingWord,
  centroid,
  nearestOnRoute,
  padBbox,
  padMeters,
  parseBbox,
  schematicXY,
  type BBox,
  type LatLng,
} from "../geo";
import { classifyPoi, featurePoint, type PosterPoi } from "./features";
import { queryOverpass } from "./overpass";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "scenic-route/lookup (local-first poster generator)";
const MAX_CANDIDATES = 8;

export type LandmarkLookupResult = {
  query: string;
  candidates: PosterPoi[];
  picked: PosterPoi | null;
  warnings: string[];
};

export async function lookupLandmark(body: {
  query: string;
  activityId: number;
  bbox?: unknown;
  latlng?: LatLng[];
}): Promise<LandmarkLookupResult> {
  const query = String(body.query ?? "").trim();
  if (!query) throw new Error("query is required");
  const activityId = Number(body.activityId);
  if (!Number.isFinite(activityId) || activityId <= 0) throw new Error("activityId is required");

  const row = getActivity(activityId);
  if (!row) throw new Error(`activity ${activityId} not found`);
  const latlng = body.latlng?.length ? body.latlng : parseLatLng(row.latlng);
  if (latlng.length < 2) throw new Error("need a GPS track to rank landmarks");

  const trackBbox = bboxFromLatLng(latlng);
  const padded: BBox =
    body.bbox != null ? parseBbox(body.bbox) : padBbox(trackBbox, padMeters(bboxDiagonal(trackBbox)));
  const warnings: string[] = [];
  const [osm, geo] = await Promise.all([
    lookupOverpass(query, padded, warnings),
    lookupNominatim(query, padded, warnings),
  ]);
  const candidates = rankCandidates(query, [...osm, ...geo], latlng, padded);
  return {
    query,
    candidates,
    picked: pickLandmark(query, candidates),
    warnings,
  };
}

export function pickLandmark(query: string, candidates: PosterPoi[]): PosterPoi | null {
  if (!candidates.length) return null;
  const folded = fold(query);
  const exact = candidates.find((item) => fold(item.name) === folded);
  if (exact) return exact;
  if (candidates.length === 1) return candidates[0];
  return null;
}

export function nameScore(query: string, name: string): number {
  const q = fold(query);
  const n = fold(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q) || q.startsWith(n)) return 80;
  if (n.includes(q)) return 65;
  if (q.includes(n)) return 50;
  const qParts = new Set(q.split(" "));
  const nParts = new Set(n.split(" "));
  if (qParts.size && [...qParts].every((part) => nParts.has(part))) return 70;
  const overlap = [...qParts].filter((part) => nParts.has(part)).length;
  return overlap ? 20 * overlap : 0;
}

function overpassNameQuery(query: string): string {
  const escaped = query.replace(/([.\\^$*+?()[\]{}|])/g, "\\$1");
  return `(nwr[name~"${escaped}",i]({{bbox}}););out geom;`;
}

async function lookupOverpass(query: string, bbox: BBox, warnings: string[]): Promise<PosterPoi[]> {
  try {
    const geojson = await queryOverpass(overpassNameQuery(query), bbox, warnings, "name search");
    const out: PosterPoi[] = [];
    for (const feature of geojson.features) {
      const name = (feature.properties as { name?: string } | null)?.name;
      const point = featurePoint(feature);
      if (!name?.trim() || !point) continue;
      const tags = ((feature.properties as { tags?: Record<string, string> })?.tags ?? {});
      out.push(barePoi(name.trim(), classifyPoi(tags), point[0], point[1], "osm"));
    }
    return out;
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Overpass lookup failed");
    return [];
  }
}

async function lookupNominatim(query: string, bbox: BBox, warnings: string[]): Promise<PosterPoi[]> {
  try {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      viewbox: `${minLng},${maxLat},${maxLng},${minLat}`,
      bounded: "0",
    });
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    const payload = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(payload)) throw new Error("Nominatim returned an unexpected payload");
    return payload.flatMap((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      const name = String(row.display_name ?? row.name ?? query).split(",")[0].trim();
      const kind = String(row.type ?? row.class ?? "feature");
      return [barePoi(name || query, kind, lat, lng, "osm")];
    });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Nominatim lookup failed");
    return [];
  }
}

function rankCandidates(query: string, rows: PosterPoi[], latlng: LatLng[], bbox: BBox): PosterPoi[] {
  const center = centroid(latlng);
  const ranked: Array<PosterPoi & { score: number }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${fold(row.name)}:${row.lat.toFixed(4)}:${row.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { distM, routeFrac } = nearestOnRoute(row.lat, row.lng, latlng);
    ranked.push({
      ...row,
      distToRouteM: Math.round(distM * 10) / 10,
      routeFrac: Math.round(routeFrac * 10_000) / 10_000,
      bearing: bearingWord(center, [row.lat, row.lng]),
      xy: schematicXY(row.lat, row.lng, bbox),
      score: nameScore(query, row.name) - distM / 200,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_CANDIDATES).map(({ score: _score, ...row }) => row);
}

function barePoi(name: string, kind: string, lat: number, lng: number, source: string): PosterPoi {
  return {
    name,
    kind,
    lat,
    lng,
    distToRouteM: 0,
    routeFrac: 0,
    bearing: "north",
    xy: { x: 0.5, y: 0.5, region: "middle-center" },
    source,
  };
}

function fold(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
