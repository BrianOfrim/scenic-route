import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  MAX_OVERPASS_DIAGONAL_M,
  bboxDiagonal,
  shouldTile,
  tileBboxes,
  type BBox,
} from "../geo";
import { OSM_CACHE_DIR } from "../paths";

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "scenic-route/overpass (https://github.com/scenic-route)";
const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TAG_KEYS = [
  "highway",
  "natural",
  "amenity",
  "waterway",
  "railway",
  "landuse",
  "water",
  "place",
  "tourism",
  "historic",
  "leisure",
  "man_made",
] as const;
const AREA_KEYS = new Set([
  "building",
  "landuse",
  "natural",
  "leisure",
  "amenity",
  "water",
  "place",
  "boundary",
]);

export type OverpassFeature = Feature<Geometry, { id: string | null; name: string | null; tags: Record<string, string> }>;

export function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function collection(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export async function queryOverpass(
  queryBody: string,
  bbox: BBox,
  warnings: string[],
  label: string,
): Promise<FeatureCollection> {
  const tiles = shouldTile(bbox) ? tileBboxes(bbox) : [bbox];
  if (tiles.some((tile) => bboxDiagonal(tile) > MAX_OVERPASS_DIAGONAL_M)) {
    warnings.push(`padded bbox is too large for Overpass; skipped ${label}`);
    return emptyCollection();
  }
  const merged: Feature[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    try {
      const payload = await postOverpass(buildQuery(queryBody, tile));
      for (const feature of elementsToFeatures(payload.elements ?? [])) {
        const id = String(feature.properties?.id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(feature);
      }
    } catch (error) {
      warnings.push(`Overpass ${label} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return collection(merged);
}

export function buildQuery(body: string, bbox: BBox): string {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bboxQl = `${minLat.toFixed(7)},${minLng.toFixed(7)},${maxLat.toFixed(7)},${maxLng.toFixed(7)}`;
  const filled = body.replaceAll("{{bbox}}", bboxQl);
  return `[out:json][timeout:25][bbox:${bboxQl}];\n${filled.trim()}\n`;
}

export function unionQuery(selectors: string[]): string {
  const lines = selectors.map((item) => `  ${item}({{bbox}});`).join("\n");
  return `(\n${lines}\n);\nout geom;`;
}

export function elementsToFeatures(elements: unknown[]): OverpassFeature[] {
  const features: OverpassFeature[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const element = raw as Record<string, unknown>;
    const kind = element.type;
    const tags = isRecord(element.tags)
      ? Object.fromEntries(
          Object.entries(element.tags).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {};
    const props = {
      id: kind && element.id != null ? `${kind}/${element.id}` : null,
      name: typeof tags.name === "string" ? tags.name : null,
      tags: pickTags(tags),
    };
    if (kind === "node") {
      if (element.lat == null || element.lon == null || !Object.keys(tags).length) continue;
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [Number(element.lon), Number(element.lat)] },
      });
      continue;
    }
    const coords = geomCoords(element.geometry);
    if (coords.length >= 2) {
      if (isArea(coords, tags)) {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      } else {
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "LineString", coordinates: coords },
        });
      }
      continue;
    }
    const center = isRecord(element.center) ? element.center : null;
    if (center && center.lat != null && center.lon != null) {
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [Number(center.lon), Number(center.lat)] },
      });
    }
  }
  return features;
}

async function postOverpass(query: string): Promise<{ elements?: unknown[] }> {
  const cached = readCache(query);
  if (cached) return cached;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = await postOnce(query);
      writeCache(query, payload);
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as { status?: number }).status;
      if (!status || !RETRYABLE.has(status) || attempt === MAX_ATTEMPTS - 1) {
        throw lastError;
      }
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("Overpass request failed");
}

async function postOnce(query: string): Promise<{ elements?: unknown[] }> {
  const endpoint = process.env.OVERPASS_URL?.trim() || DEFAULT_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    const err = new Error(`Overpass HTTP ${response.status}${detail ? `: ${detail}` : ""}`) as Error & {
      status: number;
    };
    err.status = response.status;
    throw err;
  }
  const raw = await readCapped(response);
  const payload = JSON.parse(raw) as { elements?: unknown[]; remark?: string };
  if (typeof payload.remark === "string" && payload.remark && !payload.elements?.length) {
    throw new Error(`Overpass remark: ${payload.remark}`);
  }
  return payload;
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      throw new Error(`Overpass response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cachePath(query: string) {
  const hash = createHash("sha1").update(query).digest("hex");
  return path.join(OSM_CACHE_DIR, `${hash}.json`);
}

function readCache(query: string): { elements?: unknown[] } | null {
  const file = cachePath(query);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as { elements?: unknown[] };
  } catch {
    return null;
  }
}

function writeCache(query: string, payload: unknown) {
  try {
    fs.mkdirSync(OSM_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(query), JSON.stringify(payload));
  } catch {
    // cache is optional
  }
}

function pickTags(tags: Record<string, string>) {
  const slim: Record<string, string> = {};
  for (const key of TAG_KEYS) {
    if (tags[key]) slim[key] = tags[key];
  }
  if (tags.name) slim.name = tags.name;
  return slim;
}

function geomCoords(geometry: unknown): number[][] {
  if (!Array.isArray(geometry)) return [];
  const coords: number[][] = [];
  for (const item of geometry) {
    if (item && typeof item === "object" && "lat" in item && "lon" in item) {
      const row = item as { lat: number; lon: number };
      coords.push([Number(row.lon), Number(row.lat)]);
    }
  }
  return coords;
}

function isArea(coords: number[][], tags: Record<string, string>): boolean {
  if (coords.length < 4) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) return false;
  if (tags.area === "no") return false;
  if (tags.area === "yes") return true;
  if (tags.highway && tags.area !== "yes") return false;
  return Object.keys(tags).some((key) => AREA_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
