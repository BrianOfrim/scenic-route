const TILE_SOURCES: Record<string, (z: string, x: string, y: string) => string> = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  topo: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`,
  satellite: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};

const USER_AGENT = "scenic-route/tiles (local poster grounding)";

export async function fetchTile(source: string, z: string, x: string, y: string): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  const build = TILE_SOURCES[source];
  if (!build) throw new Error("unknown tile source");
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    throw new Error("invalid tile coordinates");
  }
  const response = await fetch(build(z, x, y), {
    headers: { "User-Agent": USER_AGENT, Accept: "image/png,image/*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tile upstream ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/png";
  return { bytes, contentType };
}

export function isTileSource(source: string) {
  return source in TILE_SOURCES;
}
