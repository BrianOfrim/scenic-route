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

const DEFAULT_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];
const USER_AGENT = "scenic-route/overpass (https://github.com/scenic-route)";
const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Safety stop for one response. A tile past this is failed, not split. */
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
/** Public Overpass servers typically allow up to 180s of query runtime. */
const QUERY_TIMEOUT_S = 180;
/** Slightly above QUERY_TIMEOUT_S so the server can return its own timeout. */
const REQUEST_TIMEOUT_MS = 190_000;
/** Independent geographic tiles fetched at once. */
const TILE_CONCURRENCY = 3;
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
  "route",
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

type OverpassPoster = (query: string) => Promise<{ elements?: unknown[] }>;

export type OverpassTilePhase = "loading" | "loaded" | "split" | "dropped" | "failed";

export type OverpassTileEvent = {
  id: string;
  label: string;
  bbox: BBox;
  depth: number;
  phase: OverpassTilePhase;
};

export type OverpassTileListener = (event: OverpassTileEvent) => void | Promise<void>;

export function overpassTileId(label: string, bbox: BBox, depth: number): string {
  return `${label}:${depth}:${bbox.map((value) => value.toFixed(5)).join(",")}`;
}

export async function queryOverpass(
  queryBody: string,
  bbox: BBox,
  warnings: string[],
  label: string,
  post: OverpassPoster = postOverpass,
  onTile?: OverpassTileListener,
): Promise<FeatureCollection> {
  const tiles = shouldTile(bbox) ? tileBboxes(bbox) : [bbox];
  if (tiles.some((tile) => bboxDiagonal(tile) > MAX_OVERPASS_DIAGONAL_M)) {
    warnings.push(`padded bbox is too large for Overpass; skipped ${label}`);
    await onTile?.({ id: overpassTileId(label, bbox, 0), label, bbox, depth: 0, phase: "failed" });
    return emptyCollection();
  }
  const merged: Feature[] = [];
  const seen = new Set<string>();
  let fetchMs = 0;
  let convertMs = 0;
  let fetchedTiles = 0;

  async function loadTile(tile: BBox): Promise<void> {
    const started = performance.now();
    const tileEvent = (phase: OverpassTilePhase) =>
      onTile?.({ id: overpassTileId(label, tile, 0), label, bbox: tile, depth: 0, phase });
    await tileEvent("loading");
    try {
      const payload = await post(buildQuery(queryBody, tile));
      const fetched = performance.now();
      fetchMs += fetched - started;
      fetchedTiles += 1;
      for (const feature of elementsToFeatures(payload.elements ?? [])) {
        const id = String(feature.properties?.id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(feature);
      }
      convertMs += performance.now() - fetched;
      await tileEvent("loaded");
    } catch (error) {
      fetchMs += performance.now() - started;
      fetchedTiles += 1;
      warnings.push(`Overpass ${label} failed: ${error instanceof Error ? error.message : error}`);
      await tileEvent("failed");
    }
  }

  await runWithConcurrency(tiles, TILE_CONCURRENCY, loadTile);
  timing("query", { label, tiles: fetchedTiles, features: merged.length, fetchMs, convertMs });
  return collection(merged);
}

async function runWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}

export function buildQuery(body: string, bbox: BBox): string {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bboxQl = `${minLat.toFixed(7)},${minLng.toFixed(7)},${maxLat.toFixed(7)},${maxLng.toFixed(7)}`;
  const filled = body.replaceAll("{{bbox}}", bboxQl);
  return `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${bboxQl}];\n${filled.trim()}\n`;
}

export function unionQuery(selectors: string[], output: "geom" | "center" = "geom"): string {
  const lines = selectors.map((item) => `  ${item}({{bbox}});`).join("\n");
  return `(\n${lines}\n);\nout ${output};`;
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
    const members = relationMembers(element.members);
    if (members.length && isAreaRelation(tags, members)) {
      const geometry = assembleMultipolygon(members);
      if (geometry) {
        features.push({ type: "Feature", properties: props, geometry });
        continue;
      }
    }
    const memberLines = members.map((member) => member.coords);
    if (memberLines.length === 1) {
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "LineString", coordinates: memberLines[0] },
      });
      continue;
    }
    if (memberLines.length > 1) {
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "MultiLineString", coordinates: memberLines },
      });
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

type OverpassPayload = { elements: unknown[]; remark?: string };

function timing(event: string, fields: Record<string, unknown>) {
  if (process.env.OSM_TIMING === "1") console.info("osm.timing", { event, ...fields });
}

/** Isolated clients let tests exercise cache and transport behavior without live OSM. */
export function createOverpassClient(options: { cacheDir?: string; fetch?: typeof fetch } = {}) {
  const cacheDir = options.cacheDir ?? OSM_CACHE_DIR;
  const fetchResponse = options.fetch ?? fetch;
  const pending = new Map<string, Promise<OverpassPayload>>();

  async function load(query: string): Promise<OverpassPayload> {
    const cached = readCache(query);
    if (cached) {
      timing("cache", { status: "hit" });
      return cached;
    }
    timing("cache", { status: "miss" });
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

  async function postOnce(query: string): Promise<OverpassPayload> {
    const configured = process.env.OVERPASS_URL?.trim();
    const endpoints = configured ? [configured] : DEFAULT_ENDPOINTS;
    let lastError: Error | null = null;
    for (const endpoint of endpoints) {
      try {
        return await postToEndpoint(endpoint, query);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (lastError as Error & { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 429) throw lastError;
        if (lastError.message.includes("exceeded")) throw lastError;
      }
    }
    throw lastError ?? new Error("Overpass request failed");
  }

  async function postToEndpoint(endpoint: string, query: string): Promise<OverpassPayload> {
    const started = performance.now();
    const response = await fetchResponse(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    const payload = JSON.parse(raw) as OverpassPayload;
    if (typeof payload?.remark === "string" && payload.remark) {
      throw new Error(`Overpass remark: ${payload.remark}`);
    }
    if (!payload || !Array.isArray(payload.elements)) throw new Error("Invalid Overpass response: missing elements array");
    timing("network", { ms: performance.now() - started, bytes: Buffer.byteLength(raw), elements: payload.elements.length });
    return payload;
  }

  function cachePath(query: string) {
    const hash = createHash("sha1").update(query).digest("hex");
    return path.join(cacheDir, `${hash}.json`);
  }

  function readCache(query: string): OverpassPayload | null {
    const file = cachePath(query);
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
      const payload = JSON.parse(fs.readFileSync(file, "utf8")) as OverpassPayload;
      if (!payload || !Array.isArray(payload.elements) || payload.remark) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function writeCache(query: string, payload: unknown) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath(query), JSON.stringify(payload));
    } catch {
      // cache is optional
    }
  }

  return (query: string): Promise<OverpassPayload> => {
    const existing = pending.get(query);
    if (existing) {
      timing("cache", { status: "in-flight" });
      return existing;
    }
    const request = load(query).finally(() => pending.delete(query));
    pending.set(query, request);
    return request;
  };
}

const postOverpass = createOverpassClient();

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
      await reader.cancel();
      throw new Error(`Overpass response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pickTags(tags: Record<string, string>) {
  const slim: Record<string, string> = {};
  for (const key of TAG_KEYS) {
    if (tags[key]) slim[key] = tags[key];
  }
  if (tags.name) slim.name = tags.name;
  return slim;
}

type RelationMember = { role: "outer" | "inner"; coords: number[][] };

/** Area relations become polygons. Route relations stay lines. */
function isAreaRelation(tags: Record<string, string>, members: RelationMember[]): boolean {
  if (tags.type === "route" || tags.route) return false;
  if (tags.natural === "coastline" || tags.natural === "cliff") return false;
  if (tags.type === "multipolygon") return true;
  return members.some((member) => member.role === "inner");
}

function relationMembers(members: unknown): RelationMember[] {
  if (!Array.isArray(members)) return [];
  const lines: RelationMember[] = [];
  for (const member of members) {
    if (!isRecord(member)) continue;
    const coords = geomCoords(member.geometry);
    if (coords.length < 2) continue;
    lines.push({ role: member.role === "inner" ? "inner" : "outer", coords });
  }
  return lines;
}

/**
 * Stitch outer and inner member ways into polygon rings.
 * Member ways are not ordered or oriented; shared endpoints are.
 * Returns null when an outer shore does not close, so the caller can keep the lines.
 */
function assembleMultipolygon(members: RelationMember[]): { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  const outers = stitchRings(members.filter((member) => member.role === "outer").map((member) => member.coords));
  if (!outers.closed.length) return null;
  const inners = stitchRings(members.filter((member) => member.role === "inner").map((member) => member.coords));
  const holes = outers.closed.map(() => [] as number[][][]);
  for (const inner of inners.closed) {
    const sample = ringCentroid(inner);
    const host = outers.closed.findIndex((outer) => pointInLngLatRing(sample, outer));
    if (host >= 0) holes[host].push(inner);
  }
  const polygons = outers.closed.map((outer, index) => [outer, ...holes[index]]);
  if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
  return { type: "MultiPolygon", coordinates: polygons };
}

function stitchRings(lines: number[][][]): { closed: number[][][]; open: number[][][] } {
  const closed: number[][][] = [];
  const openLines: number[][][] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    if (ringClosed(line)) closed.push(line);
    else openLines.push(line);
  }
  const used = new Array<boolean>(openLines.length).fill(false);
  const open: number[][][] = [];
  for (let i = 0; i < openLines.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    let ring = openLines[i].slice();
    let grew = true;
    while (grew && !ringClosed(ring)) {
      grew = false;
      const endKey = coordKey(ring[ring.length - 1]);
      const startKey = coordKey(ring[0]);
      for (let j = 0; j < openLines.length; j += 1) {
        if (used[j]) continue;
        const line = openLines[j];
        const head = coordKey(line[0]);
        const tail = coordKey(line[line.length - 1]);
        if (head === endKey) {
          ring = ring.concat(line.slice(1));
        } else if (tail === endKey) {
          ring = ring.concat(line.slice().reverse().slice(1));
        } else if (tail === startKey) {
          ring = line.concat(ring.slice(1));
        } else if (head === startKey) {
          ring = line.slice().reverse().concat(ring.slice(1));
        } else {
          continue;
        }
        used[j] = true;
        grew = true;
        break;
      }
    }
    if (ringClosed(ring)) closed.push(ring);
    else open.push(ring);
  }
  return { closed, open };
}

function ringClosed(line: number[][]): boolean {
  if (line.length < 4) return false;
  return coordKey(line[0]) === coordKey(line[line.length - 1]);
}

function coordKey(coord: number[]): string {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

function ringCentroid(ring: number[][]): [number, number] {
  const limit = ringClosed(ring) ? ring.length - 1 : ring.length;
  let x = 0;
  let y = 0;
  for (let i = 0; i < limit; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / limit, y / limit];
}

function pointInLngLatRing(point: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const intersect = a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] + 0) + a[0];
    if (intersect) inside = !inside;
  }
  return inside;
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
  if (tags.natural === "coastline" || tags.natural === "cliff") return false;
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
