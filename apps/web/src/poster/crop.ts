import {
  BEACH_NEAR_ROUTE_M,
  DEFAULT_NEAR_ROUTE_M,
  TOWN_NEAR_ROUTE_M,
  nearRouteMForKind,
} from "./featureCatalog";

export function snapRadius(length: number): number {
  return Math.max(4, Math.min(16, Math.round(Math.max(1, length - 1) * 0.012)));
}

export function snapIndex(value: number, targets: number[], radius: number): number {
  const rounded = Math.round(value);
  if (!targets.length || radius < 0) return rounded;
  let best = rounded;
  let bestDist = radius + 1;
  for (const target of targets) {
    const dist = Math.abs(target - rounded);
    if (dist < bestDist) {
      best = target;
      bestDist = dist;
    }
  }
  return bestDist <= radius ? best : rounded;
}

export function clampCrop(length: number, start: number, end: number): [number, number] {
  if (length < 2) return [0, Math.max(0, length - 1)];
  const lo = Math.max(0, Math.min(length - 2, Math.round(start)));
  const hi = Math.max(lo + 1, Math.min(length - 1, Math.round(end)));
  return [lo, hi];
}

export function sliceTrack(latlng: [number, number][], start: number, end: number): [number, number][] {
  const [lo, hi] = clampCrop(latlng.length, start, end);
  return latlng.slice(lo, hi + 1);
}

export function sliceTrackBreaks(breaks: readonly number[], length: number, start: number, end: number): number[] {
  const [lo, hi] = clampCrop(length, start, end);
  return breaks.filter((index) => index > lo && index <= hi).map((index) => index - lo);
}

/** Same corridor the API uses when first picking landmarks. */
export const LANDMARK_NEAR_ROUTE_M = DEFAULT_NEAR_ROUTE_M;
export { BEACH_NEAR_ROUTE_M, TOWN_NEAR_ROUTE_M };

export function landmarkNearRouteM(kind?: string, nearByFeature: Record<string, number> = {}): number {
  return nearRouteMForKind(kind, nearByFeature);
}

export function distToTrackM(point: [number, number], latlng: [number, number][]): number {
  let best = Infinity;
  for (const vertex of latlng) {
    const dist = haversineM(vertex, point);
    if (dist < best) best = dist;
    if (best === 0) return 0;
  }
  return best;
}

export function isNearCroppedRoute(
  extra: { lat: number; lng: number; kind?: string },
  latlng: [number, number][],
  maxM = landmarkNearRouteM(extra.kind),
): boolean {
  if (latlng.length < 2) return false;
  return distToTrackM([extra.lat, extra.lng], latlng) <= maxM;
}

/** Shift full-track indexes into a cropped track. Empty is still spanned. */
export function shiftRouteSpans(
  spans: Array<{ start: number; end: number }> | undefined,
  cropStart: number,
  cropEnd: number,
): Array<{ start: number; end: number }> | undefined {
  if (spans === undefined) return undefined;
  const shifted: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const start = Math.max(span.start, cropStart) - cropStart;
    const end = Math.min(span.end, cropEnd) - cropStart;
    if (end < start) continue;
    shifted.push({ start, end });
  }
  return shifted;
}

export function isClosedLoop(latlng: [number, number][], breaks: readonly number[] = []): boolean {
  if (latlng.length < 2) return false;
  if (breaks.length) return false;
  const closeM = Math.max(150, 0.02 * trackDistanceM(latlng));
  return haversineM(latlng[0], latlng[latlng.length - 1]) <= closeM;
}

export function trackDistanceM(latlng: [number, number][], breaks: readonly number[] = []): number {
  const starts = new Set(breaks);
  let total = 0;
  for (let i = 1; i < latlng.length; i += 1) {
    if (!starts.has(i)) total += haversineM(latlng[i - 1], latlng[i]);
  }
  return total;
}

type BboxPad = {
  padFrac?: number;
  minPadM?: number;
  maxPadM?: number;
};

/** Wider box for map/search. Schematic rendering uses `schematicBbox`. */
export function paddedBbox(
  latlng: [number, number][],
  extras: Array<{ lat: number; lng: number }> = [],
  pad: BboxPad = {},
): [[number, number], [number, number]] {
  const lats = latlng.map((point) => point[0]);
  const lngs = latlng.map((point) => point[1]);
  for (const extra of extras) {
    lats.push(extra.lat);
    lngs.push(extra.lng);
  }
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const diagonal = haversineM([minLat, minLng], [maxLat, maxLng]);
  const padM = Math.min(pad.maxPadM ?? 5_000, Math.max(pad.minPadM ?? 400, (pad.padFrac ?? 0.15) * diagonal));
  const midLat = (minLat + maxLat) / 2;
  const dlat = padM / 111_320;
  const dlng = padM / (111_320 * Math.max(0.2, Math.abs(Math.cos((midLat * Math.PI) / 180))));
  return [
    [minLng - dlng, minLat - dlat],
    [maxLng + dlng, maxLat + dlat],
  ];
}

const SCHEMATIC_NEAR_ROUTE_M = 600;

/** Tight frame for grounding images: small pad, only landmarks near the track. */
export function schematicBbox(
  latlng: [number, number][],
  extras: Array<{ lat: number; lng: number; distToRouteM?: number; kind?: string }> = [],
  nearByFeature: Record<string, number> = {},
): [[number, number], [number, number]] {
  const near = extras.filter((item) =>
    isNearTrack(latlng, item, Math.max(SCHEMATIC_NEAR_ROUTE_M, landmarkNearRouteM(item.kind, nearByFeature))),
  );
  return paddedBbox(latlng, near, { padFrac: 0.06, minPadM: 200, maxPadM: 1_200 });
}

function isNearTrack(
  latlng: [number, number][],
  extra: { lat: number; lng: number; distToRouteM?: number; kind?: string },
  maxM: number,
) {
  if (typeof extra.distToRouteM === "number") return extra.distToRouteM <= maxM;
  return isNearCroppedRoute(extra, latlng, maxM);
}

function haversineM(a: [number, number], b: [number, number]) {
  const radius = 6_371_000;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(s)));
}
