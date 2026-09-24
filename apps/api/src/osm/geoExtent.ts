/** Extra geography extents: rotated box, convex hull, loop interior, and area-aware corridor. */

import { clipWaysToCorridor, clipWaysToVariableCorridor, type LatLng } from "./corridor";

export type LngLat = [number, number];

type Pt = { x: number; y: number };

const M_PER_DEG = 111_320;

const AREA_BUCKETS = new Set([
  "water",
  "parks",
  "forest",
  "farmland",
  "wetlands",
  "vegetation",
  "beaches",
  "rock",
  "glaciers",
  "cemeteries",
]);

type ExtentFeature = {
  geometry?: { type?: string; coordinates?: unknown } | null;
};

/** Padding around an automatic outline, scaled to the route and snapped to 50 m. */
export function shapePadM(route: LatLng[]): number {
  const diag = diagonalM(route);
  const raw = Math.min(800, Math.max(150, 0.035 * diag));
  return Math.round(raw / 50) * 50;
}

/** Wider context at the start and finish. The middle keeps `midM`. */
export function endRadiusM(midM: number): number {
  return Math.round(Math.max(midM * 2.5, midM + 700) / 50) * 50;
}

/** One radius per route vertex. The ends ease into the tighter middle. */
export function radiusAlongRoute(route: LatLng[], midM: number, endM: number): number[] {
  if (route.length === 0) return [];
  const along = cumulativeM(route);
  const total = along[along.length - 1] || 1;
  const endLen = Math.min(total * 0.3, Math.max(total * 0.12, 250));
  const endFrac = endLen / total;
  return route.map((_, index) => {
    const frac = along[index] / total;
    const fromStart = frac < endFrac ? 1 - frac / endFrac : 0;
    const fromEnd = frac > 1 - endFrac ? (frac - (1 - endFrac)) / endFrac : 0;
    const weight = Math.max(fromStart, fromEnd);
    const eased = weight * weight * (3 - 2 * weight);
    return midM + (endM - midM) * eased;
  });
}

/** Smallest rotated rectangle around the route, expanded by `padM`. */
export function rotatedBoxRing(route: LatLng[], padM: number): LngLat[] {
  if (route.length === 0) return [];
  const lat0 = meanLat(route);
  const local = route.map(([lat, lng]) => project(lng, lat, lat0));
  const hull = convexHull(local);
  const box = rotatedBox(hull, padM);
  return box.map((point) => unproject(point, lat0));
}

/** Convex outline of the route, expanded by `padM`. */
export function convexHullRing(route: LatLng[], padM: number): LngLat[] {
  if (route.length === 0) return [];
  const lat0 = meanLat(route);
  const hull = convexHull(route.map(([lat, lng]) => project(lng, lat, lat0)));
  const padded = hull.length >= 3 ? offsetRing(ensureCcw(hull), padM) : rotatedBox(hull, padM);
  return padded.map((point) => unproject(point, lat0));
}

/**
 * Closed routes become the loop interior plus a thin outside band.
 * Open routes return null.
 */
export function loopBandRing(route: LatLng[], bandM: number): LngLat[] | null {
  if (!isLoop(route)) return null;
  const lat0 = meanLat(route);
  const local = route.map(([lat, lng]) => project(lng, lat, lat0));
  const simplified = simplify(local, 28, 140);
  const ring = ensureCcw(closeLocal(simplified));
  if (ring.length < 3) return null;
  const offset = offsetRing(ring, bandM);
  const chosen = segmentsCross(offset) ? ring : offset;
  return chosen.map((point) => unproject(point, lat0));
}

/** Axis-aligned box from two opposite corners. Ring order is SW, SE, NE, NW. */
export function rectangleRing(a: LngLat, b: LngLat): LngLat[] {
  const minLng = Math.min(a[0], b[0]);
  const maxLng = Math.max(a[0], b[0]);
  const minLat = Math.min(a[1], b[1]);
  const maxLat = Math.max(a[1], b[1]);
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
  ];
}

export function rectangleTooSmall(ring: LngLat[]): boolean {
  if (ring.length < 2) return true;
  const lat0 = ring[0][1];
  const a = project(ring[0][0], ring[0][1], lat0);
  const b = project(ring[2]?.[0] ?? ring[1][0], ring[2]?.[1] ?? ring[1][1], lat0);
  return Math.abs(b.x - a.x) < 20 || Math.abs(b.y - a.y) < 20;
}

/** Corridor for lines. Parks, lakes, and other areas the route meets are kept whole. */
export function clipWaysKeepingTouchedAreas<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  route: LatLng[],
  radiusM: number,
): Record<string, T> {
  const clipped = clipWaysToCorridor(ways, route, radiusM);
  if (route.length < 2) return clipped;
  const lat0 = meanLat(route);
  const samples = sampleRoute(route, lat0, 160);
  for (const key of Object.keys(ways)) {
    if (!AREA_BUCKETS.has(key)) continue;
    const features = ((ways[key]?.features ?? []) as ExtentFeature[]).filter((feature) =>
      areaTouchesRoute(feature, samples, lat0, radiusM),
    );
    clipped[key] = { ...ways[key], features: features as T["features"] };
  }
  return clipped;
}

/** Outer rings of parks, lakes, and landcover the route actually meets. */
export function touchedAreaRings(
  ways: Record<string, { features?: unknown[] } | undefined>,
  route: LatLng[],
  radiusM: number,
): LngLat[][] {
  if (route.length < 2) return [];
  const lat0 = meanLat(route);
  const samples = sampleRoute(route, lat0, 160);
  const rings: LngLat[][] = [];
  for (const key of Object.keys(ways)) {
    if (!AREA_BUCKETS.has(key)) continue;
    for (const feature of (ways[key]?.features ?? []) as ExtentFeature[]) {
      if (!areaTouchesRoute(feature, samples, lat0, radiusM)) continue;
      for (const ring of outerRings(feature.geometry)) {
        if (ring.length >= 3) rings.push(ring.map((pair) => [pair[0], pair[1]]));
      }
    }
  }
  return rings;
}

export function clipWaysWiderAtEnds<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  route: LatLng[],
  midM: number,
): Record<string, T> {
  return clipWaysToVariableCorridor(ways, route, radiusAlongRoute(route, midM, endRadiusM(midM)));
}

function areaTouchesRoute(feature: ExtentFeature, route: Pt[], lat0: number, radiusM: number): boolean {
  for (const ring of outerRings(feature.geometry)) {
    const local = openRing(ring).map(([lng, lat]) => project(lng, lat, lat0));
    if (local.length < 3) continue;
    if (!boundsNear(local, route, radiusM)) continue;
    const simplified = simplify(local, 20, 160);
    if (ringHits(simplified, route, radiusM)) return true;
  }
  return false;
}

function ringHits(ring: Pt[], route: Pt[], radiusM: number): boolean {
  const radius2 = radiusM * radiusM;
  for (const point of route) {
    if (pointInRing(point, ring)) return true;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (pointSegmentDistance2(point, a, b) <= radius2) return true;
    }
  }
  return false;
}

function outerRings(geometry: ExtentFeature["geometry"]): number[][][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") return [asRing(geometry.coordinates)];
  if (geometry.type === "MultiPolygon") {
    return asPolygons(geometry.coordinates).map((polygon) => polygon[0] ?? []).filter((ring) => ring.length >= 3);
  }
  return [];
}

function asRing(value: unknown): number[][] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
  return value[0] as number[][];
}

function asPolygons(value: unknown): number[][][][] {
  return Array.isArray(value) ? (value as number[][][][]) : [];
}

function openRing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function pointInRing(point: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const intersect = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 0) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function boundsNear(ring: Pt[], route: Pt[], radiusM: number): boolean {
  const a = ringBounds(ring);
  const b = ringBounds(route);
  return a.minX - radiusM <= b.maxX && a.maxX + radiusM >= b.minX && a.minY - radiusM <= b.maxY && a.maxY + radiusM >= b.minY;
}

function sampleRoute(route: LatLng[], lat0: number, maxPoints: number): Pt[] {
  const local = route.map(([lat, lng]) => project(lng, lat, lat0));
  return simplify(local, 40, maxPoints);
}

function rotatedBox(hull: Pt[], pad: number): Pt[] {
  if (hull.length === 0) return [];
  if (hull.length === 1) return square(hull[0], pad);
  if (hull.length === 2) return segmentBox(hull[0], hull[1], pad);
  let best: Pt[] | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of hull) {
      const x = point.x * cos + point.y * sin;
      const y = -point.x * sin + point.y * cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    minX -= pad;
    maxX += pad;
    minY -= pad;
    maxY += pad;
    const area = (maxX - minX) * (maxY - minY);
    if (area >= bestArea) continue;
    bestArea = area;
    const corners: Array<[number, number]> = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    best = corners.map(([x, y]) => ({ x: x * cos - y * sin, y: x * sin + y * cos }));
  }
  return best ?? hull;
}

function square(center: Pt, pad: number): Pt[] {
  return [
    { x: center.x - pad, y: center.y - pad },
    { x: center.x + pad, y: center.y - pad },
    { x: center.x + pad, y: center.y + pad },
    { x: center.x - pad, y: center.y + pad },
  ];
}

function segmentBox(a: Pt, b: Pt, pad: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const px = -uy * pad;
  const py = ux * pad;
  const ex = ux * pad;
  const ey = uy * pad;
  return [
    { x: a.x - ex + px, y: a.y - ey + py },
    { x: b.x + ex + px, y: b.y + ey + py },
    { x: b.x + ex - px, y: b.y + ey - py },
    { x: a.x - ex - px, y: a.y - ey - py },
  ];
}

function convexHull(points: Pt[]): Pt[] {
  const unique = dedupe(points.slice().sort((a, b) => a.x - b.x || a.y - b.y));
  if (unique.length <= 2) return unique;
  const lower: Pt[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Pt[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross(origin: Pt, a: Pt, b: Pt): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function ensureCcw(ring: Pt[]): Pt[] {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

function offsetRing(ring: Pt[], pad: number): Pt[] {
  if (ring.length < 3 || pad === 0) return ring;
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const prev = ring[(i + ring.length - 1) % ring.length];
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];
    const n1 = outwardNormal(prev, curr);
    const n2 = outwardNormal(curr, next);
    let bx = n1.x + n2.x;
    let by = n1.y + n2.y;
    const len = Math.hypot(bx, by) || 1;
    bx /= len;
    by /= len;
    const denom = Math.max(0.35, bx * n1.x + by * n1.y);
    const miter = Math.min(2, 1 / denom);
    out.push({ x: curr.x + bx * pad * miter, y: curr.y + by * pad * miter });
  }
  return out;
}

function outwardNormal(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
}

function segmentsCross(ring: Pt[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (properCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const ab = cross(a, b, c) * cross(a, b, d);
  const cd = cross(c, d, a) * cross(c, d, b);
  return ab < 0 && cd < 0;
}

function closeLocal(points: Pt[]): Pt[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) < 1) return points.slice(0, -1);
  return points;
}

function isLoop(route: LatLng[]): boolean {
  if (route.length < 4) return false;
  const length = cumulativeM(route)[route.length - 1] ?? 0;
  return distM(route[0], route[route.length - 1]) <= Math.max(150, 0.02 * length);
}

function cumulativeM(route: LatLng[]): number[] {
  const along = [0];
  for (let i = 1; i < route.length; i += 1) along.push(along[i - 1] + distM(route[i - 1], route[i]));
  return along;
}

function diagonalM(route: LatLng[]): number {
  if (route.length < 2) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of route) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return distM([minLat, minLng], [maxLat, maxLng]);
}

function distM(a: LatLng, b: LatLng): number {
  const lat0 = ((a[0] + b[0]) / 2) * Math.PI / 180;
  const dy = (b[0] - a[0]) * M_PER_DEG;
  const dx = (b[1] - a[1]) * M_PER_DEG * Math.cos(lat0);
  return Math.hypot(dx, dy);
}

function meanLat(route: LatLng[]): number {
  return route.reduce((sum, point) => sum + point[0], 0) / route.length;
}

function project(lng: number, lat: number, lat0: number): Pt {
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return { x: lng * M_PER_DEG * cos, y: lat * M_PER_DEG };
}

function unproject(point: Pt, lat0: number): LngLat {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 1;
  return [point.x / (M_PER_DEG * cos), point.y / M_PER_DEG];
}

function simplify(points: Pt[], tolerance: number, maxPoints: number): Pt[] {
  if (points.length <= 2) return points;
  let tol = tolerance;
  let simplified = douglasPeucker(points, tol);
  while (simplified.length > maxPoints && tol < tolerance * 32) {
    tol *= 1.6;
    simplified = douglasPeucker(points, tol);
  }
  return simplified;
}

function douglasPeucker(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let best = 0;
    let bestAt = -1;
    for (let i = start + 1; i < end; i += 1) {
      const dist = pointSegmentDistance2(points[i], points[start], points[end]);
      if (dist > best) {
        best = dist;
        bestAt = i;
      }
    }
    if (bestAt >= 0 && best > tol2) {
      keep[bestAt] = true;
      stack.push([start, bestAt], [bestAt, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function pointSegmentDistance2(point: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  const x = a.x + t * dx - point.x;
  const y = a.y + t * dy - point.y;
  return x * x + y * y;
}

function signedArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function dedupe(points: Pt[]): Pt[] {
  const next: Pt[] = [];
  for (const point of points) {
    const prev = next[next.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 0.01 && Math.abs(prev.y - point.y) < 0.01) continue;
    next.push(point);
  }
  return next;
}

function ringBounds(ring: Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
