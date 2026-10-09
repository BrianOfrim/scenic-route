import path from "node:path";
import { DATA_DIR } from "./paths";
import { TileCache, TileError, type Tile } from "./tileCache";

const TILE_SOURCES: Record<string, (z: string, x: string, y: string) => string> = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  topo: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
  satellite: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};
const USER_AGENT = "scenic-route/tiles (local poster grounding)";
let osmCache: TileCache | undefined;
function limit(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new TileError("Invalid OpenStreetMap cache configuration");
  return Number(value);
}
function cache() {
  return osmCache ??= new TileCache({
    dir: process.env.OSM_TILE_CACHE_DIR || (process.env.NODE_ENV === "production" ? "/tile-cache" : path.join(DATA_DIR, "tile-cache")),
    maxBytes: limit("OSM_TILE_CACHE_MAX_BYTES", 2 * 1024 ** 3),
    maxEntries: limit("OSM_TILE_CACHE_MAX_ENTRIES", 50_000),
    production: process.env.NODE_ENV === "production",
    log: (event, metrics) => console.info("osm_tile_cache", { event, ...metrics }),
  });
}
export function osmReferer(value?: string): string {
  const configured = process.env.OSM_TILE_ALLOWED_ORIGINS;
  const origins = configured ? configured.split(",").map(origin => origin.trim()) : process.env.NODE_ENV === "production"
    ? ["https://scenic-route.ca", "https://scenic-route.fly.dev"] : [process.env.WEB_ORIGIN || "http://localhost:5174"];
  try {
    const url = new URL(value ?? "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !origins.includes(url.origin)) throw new Error("invalid referer");
    return `${url.origin}/`;
  } catch { throw new TileError("A valid Scenic Route referring website is required", 403); }
}
export async function fetchTile(source: string, z: string, x: string, y: string, referer?: string): Promise<Tile> {
  if (!isTileSource(source)) throw new TileError("unknown tile source", 404);
  if (![z, x, y].every(value => /^\d+$/.test(value))) throw new TileError("invalid tile coordinates", 400);
  if (source === "osm") {
    const numbers = [z, x, y].map(Number);
    if (!numbers.every(Number.isSafeInteger) || numbers[0] > 19 || numbers[1] >= 2 ** numbers[0] || numbers[2] >= 2 ** numbers[0]) throw new TileError("invalid tile coordinates", 400);
    if (process.env.OSM_TILES_ENABLED === "false") throw new TileError("OpenStreetMap tiles are disabled");
    const origin = osmReferer(referer);
    return cache().get(TILE_SOURCES.osm(...numbers.map(String) as [string, string, string]), origin);
  }
  // Other providers retain their existing fetching and caching behavior.
  const response = await fetch(TILE_SOURCES[source](z, x, y), {
    headers: { "User-Agent": USER_AGENT, Accept: "image/png,image/*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tile upstream ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "image/png" };
}
export function isTileSource(source: string) { return Object.hasOwn(TILE_SOURCES, source); }
