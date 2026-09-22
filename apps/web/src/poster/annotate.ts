import type { NamedWay, PosterPoi } from "../api";

export type LatLng = [number, number];
export type BBoxCorners = [[number, number], [number, number]];

const COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

const EARTH_M = 6_371_000;

export function haversineM(a: LatLng, b: LatLng): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function nearestRouteHit(point: LatLng, route: LatLng[]): {
  index: number;
  distM: number;
  routeFrac: number;
} {
  if (!route.length) return { index: 0, distM: Infinity, routeFrac: 0 };
  let bestIndex = 0;
  let bestDist = Infinity;
  if (route.length === 1) {
    return { index: 0, distM: haversineM(point, route[0]), routeFrac: 0 };
  }
  for (let i = 0; i < route.length - 1; i += 1) {
    const { distM, t } = distToSegmentM(point, route[i], route[i + 1]);
    if (distM >= bestDist) continue;
    bestDist = distM;
    bestIndex = t < 0.5 ? i : i + 1;
  }
  const denom = Math.max(1, route.length - 1);
  return { index: bestIndex, distM: bestDist, routeFrac: bestIndex / denom };
}

export function orderedSpan(start: number, end: number): { start: number; end: number } {
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function userLandmark(
  name: string,
  lat: number,
  lng: number,
  route: LatLng[],
  bbox: BBoxCorners | null | undefined,
): PosterPoi | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const hit = nearestRouteHit([lat, lng], route);
  const center = routeCentroid(route);
  const xy = bbox ? schematicXY(lat, lng, bbox) : { x: 0.5, y: 0.5, region: "middle-center" };
  return {
    name: trimmed,
    kind: "landmark",
    lat,
    lng,
    distToRouteM: Math.round(hit.distM * 10) / 10,
    routeFrac: Math.round(hit.routeFrac * 10_000) / 10_000,
    bearing: center ? bearingWord(center, [lat, lng]) : "north",
    xy,
    source: "user",
  };
}

export function relocateLandmark(
  poi: PosterPoi,
  lat: number,
  lng: number,
  route: LatLng[],
  bbox: BBoxCorners | null | undefined,
): PosterPoi | null {
  const next = userLandmark(poi.name, lat, lng, route, bbox);
  if (!next) return null;
  return {
    ...next,
    kind: poi.kind,
    source: "user",
    inside: poi.inside,
  };
}

export function renamedLandmark(
  poi: PosterPoi,
  nextName: string,
  taken: string[],
): PosterPoi | { error: string } {
  const name = nextName.trim();
  if (!name) return { error: "Name this landmark" };
  const current = poi.name.trim().toLowerCase();
  if (taken.some((item) => item.trim().toLowerCase() !== current && item.trim().toLowerCase() === name.toLowerCase())) {
    return { error: `“${name}” is already a landmark` };
  }
  return { ...poi, name, source: "user" };
}

export function trailSourceName(name: string, aliases: Record<string, string>): string {
  for (const [source, display] of Object.entries(aliases)) {
    if (display === name) return source;
  }
  return name;
}

export function applyTrailAlias<T extends { name: string }>(
  trail: T,
  aliases: Record<string, string>,
): T {
  const name = aliases[trail.name];
  return name && name !== trail.name ? { ...trail, name } : trail;
}

export function nextTrailAliases(
  name: string,
  nextName: string,
  aliases: Record<string, string>,
  taken: string[],
): { aliases: Record<string, string>; display: string } | { error: string } {
  const trimmed = nextName.trim();
  if (!trimmed) return { error: "Name this stretch" };
  const source = trailSourceName(name, aliases);
  const conflict = taken.some((item) => {
    if (trailSourceName(item, aliases) === source) return false;
    return item.trim().toLowerCase() === trimmed.toLowerCase();
  });
  if (conflict) return { error: `“${trimmed}” is already a named stretch` };
  if (trimmed === source) {
    if (!(source in aliases)) return { aliases, display: source };
    const next = { ...aliases };
    delete next[source];
    return { aliases: next, display: source };
  }
  return { aliases: { ...aliases, [source]: trimmed }, display: trimmed };
}

export function userNamedWay(
  name: string,
  startIndex: number,
  endIndex: number,
  route: LatLng[],
  bbox: BBoxCorners | null | undefined,
): NamedWay | null {
  const trimmed = name.trim();
  if (!trimmed || route.length < 2) return null;
  const last = route.length - 1;
  const start = Math.max(0, Math.min(last - 1, Math.round(Math.min(startIndex, endIndex))));
  const end = Math.max(start + 1, Math.min(last, Math.round(Math.max(startIndex, endIndex))));
  const slice = route.slice(start, end + 1);
  if (slice.length < 2) return null;
  const mid = slice[Math.floor(slice.length / 2)];
  const center = routeCentroid(route);
  const xy = bbox
    ? schematicXY(mid[0], mid[1], bbox)
    : { x: 0.5, y: 0.5, region: "middle-center" };
  return {
    name: trimmed,
    kind: "path",
    geometry: {
      type: "MultiLineString",
      coordinates: [slice.map(([lat, lng]) => [lng, lat])],
    },
    lat: mid[0],
    lng: mid[1],
    distToRouteM: 0,
    routeFrac: Math.round((end + start) / 2 / Math.max(1, last) * 10_000) / 10_000,
    bearing: center ? bearingWord(center, mid) : "north",
    xy,
    source: "user",
    routeSpans: [{ start, end }],
  };
}

export function resizedNamedWay(
  trail: NamedWay,
  startIndex: number,
  endIndex: number,
  route: LatLng[],
  bbox: BBoxCorners | null | undefined,
): NamedWay | null {
  const resized = userNamedWay(trail.name, startIndex, endIndex, route, bbox);
  return resized ? { ...resized, kind: trail.kind, source: trail.source } : null;
}

export function bearingWord(from: LatLng, to: LatLng): string {
  const lat1 = (from[0] * Math.PI) / 180;
  const lat2 = (to[0] * Math.PI) / 180;
  const dlng = ((to[1] - from[1]) * Math.PI) / 180;
  const y = Math.sin(dlng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlng);
  const deg = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

export function schematicXY(
  lat: number,
  lng: number,
  bbox: BBoxCorners,
): { x: number; y: number; region: string } {
  const [[minLng, minLat], [maxLng, maxLat]] = bbox;
  let x0 = mercX(minLng);
  let x1 = mercX(maxLng);
  let y0 = mercY(maxLat);
  let y1 = mercY(minLat);
  if (x1 <= x0) x1 = x0 + 1e-6;
  if (y1 <= y0) y1 = y0 + 1e-6;
  const x = (mercX(lng) - x0) / (x1 - x0);
  const y = (mercY(lat) - y0) / (y1 - y0);
  const col = x < 0.33 ? "left" : x < 0.66 ? "center" : "right";
  const row = y < 0.33 ? "upper" : y < 0.66 ? "middle" : "lower";
  return { x: round4(x), y: round4(y), region: `${row}-${col}` };
}

function routeCentroid(route: LatLng[]): LatLng | null {
  if (!route.length) return null;
  const step = Math.max(1, Math.floor(route.length / 40));
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (let i = 0; i < route.length; i += step) {
    lat += route[i][0];
    lng += route[i][1];
    n += 1;
  }
  return [lat / n, lng / n];
}

function distToSegmentM(point: LatLng, a: LatLng, b: LatLng): { distM: number; t: number } {
  const midLat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const kx = 111_320 * Math.max(0.2, Math.abs(Math.cos(midLat)));
  const ky = 111_320;
  const ax = a[1] * kx;
  const ay = a[0] * ky;
  const bx = b[1] * kx;
  const by = b[0] * ky;
  const px = point[1] * kx;
  const py = point[0] * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { distM: Math.hypot(ax + t * dx - px, ay + t * dy - py), t };
}

function mercX(lng: number) {
  return (lng + 180) / 360;
}

function mercY(lat: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
