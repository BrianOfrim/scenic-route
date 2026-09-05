export type LatLng = [number, number];
export type BBox = [number, number, number, number];
export type BBoxCorners = [[number, number], [number, number]];

export const EARTH_M = 6_371_000;
export const MAX_OVERPASS_DIAGONAL_M = 50_000;
export const MIN_PAD_M = 400;
export const MAX_PAD_M = 5_000;
export const PAD_FRACTION = 0.15;
export const LOOP_CLOSE_M = 150;

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

export function haversineM(a: LatLng, b: LatLng): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function trackDistanceM(latlng: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < latlng.length; i += 1) {
    total += haversineM(latlng[i - 1], latlng[i]);
  }
  return total;
}

export function bboxFromLatLng(latlng: LatLng[]): BBox {
  const lats = latlng.map((p) => p[0]);
  const lngs = latlng.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export function bboxDiagonal(bbox: BBox): number {
  return haversineM([bbox[1], bbox[0]], [bbox[3], bbox[2]]);
}

export function padMeters(diagonalM: number): number {
  return Math.min(MAX_PAD_M, Math.max(MIN_PAD_M, PAD_FRACTION * diagonalM));
}

export function padBbox(bbox: BBox, padM: number): BBox {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const dlat = padM / 111_320;
  const clat = Math.max(0.2, Math.abs(Math.cos((midLat * Math.PI) / 180)));
  const dlng = padM / (111_320 * clat);
  return [minLng - dlng, minLat - dlat, maxLng + dlng, maxLat + dlat];
}

export function bboxToCorners(bbox: BBox): BBoxCorners {
  return [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[3]],
  ];
}

export function parseBbox(raw: unknown): BBox {
  if (Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && Array.isArray(raw[1])) {
    return [Number(raw[0][0]), Number(raw[0][1]), Number(raw[1][0]), Number(raw[1][1])];
  }
  if (Array.isArray(raw) && raw.length === 4) {
    return [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
  }
  throw new Error("bbox must be [minLng, minLat, maxLng, maxLat] or [[minLng, minLat], [maxLng, maxLat]]");
}

export function isLoop(latlng: LatLng[], diagonalM: number): boolean {
  if (latlng.length < 2) return false;
  const closeM = Math.max(LOOP_CLOSE_M, 0.02 * diagonalM);
  return haversineM(latlng[0], latlng[latlng.length - 1]) <= closeM;
}

export function shouldTile(bbox: BBox): boolean {
  return bboxDiagonal(bbox) > MAX_OVERPASS_DIAGONAL_M;
}

export function tileBboxes(bbox: BBox): BBox[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLng = (minLng + maxLng) / 2;
  const midLat = (minLat + maxLat) / 2;
  return [
    [minLng, minLat, midLng, midLat],
    [midLng, minLat, maxLng, midLat],
    [minLng, midLat, midLng, maxLat],
    [midLng, midLat, maxLng, maxLat],
  ];
}

export function simplifyLatLng(latlng: LatLng[], maxPoints = 1200): LatLng[] {
  if (latlng.length <= maxPoints) return latlng;
  const step = (latlng.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => latlng[Math.round(i * step)]);
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

export function nearestOnRoute(lat: number, lng: number, latlng: LatLng[]): { distM: number; routeFrac: number } {
  const [samples, indexes] = routeSamples(latlng, 800);
  let bestDist = Number.POSITIVE_INFINITY;
  let bestIdx = 0;
  const point: LatLng = [lat, lng];
  for (let i = 0; i < samples.length; i += 1) {
    const dist = haversineM(point, samples[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = indexes[i];
    }
  }
  const denom = Math.max(1, latlng.length - 1);
  return { distM: bestDist, routeFrac: bestIdx / denom };
}

export function centroid(latlng: LatLng[]): LatLng {
  const [samples] = routeSamples(latlng, 40);
  const lat = samples.reduce((sum, p) => sum + p[0], 0) / samples.length;
  const lng = samples.reduce((sum, p) => sum + p[1], 0) / samples.length;
  return [lat, lng];
}

export function mercX(lng: number) {
  return (lng + 180) / 360;
}

export function mercY(lat: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function schematicXY(
  lat: number,
  lng: number,
  bbox: BBox,
): { x: number; y: number; region: string } {
  const [minLng, minLat, maxLng, maxLat] = bbox;
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

function routeSamples(latlng: LatLng[], maxPoints: number): [LatLng[], number[]] {
  if (latlng.length <= maxPoints) {
    return [latlng, latlng.map((_, i) => i)];
  }
  const step = (latlng.length - 1) / (maxPoints - 1);
  const indexes = Array.from({ length: maxPoints }, (_, i) => Math.round(i * step));
  return [indexes.map((i) => latlng[i]), indexes];
}

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}
