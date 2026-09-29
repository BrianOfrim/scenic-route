/** Extra geography extents: rotated box, convex hull, loop interior, and area-aware corridor. */

import { padBbox, type BBox } from "../geo";
import {
  clipWaysToCorridor,
  clipWaysToVariableCorridor,
  keepWaysTouchingCorridor,
  keepWaysTouchingVariableCorridor,
  type LatLng,
} from "./corridor";

export type LngLat = [number, number];

type Pt = { x: number; y: number };

const M_PER_DEG = 111_320;

const AREA_BUCKETS = new Set([
  "water",
  "ocean",
  "riverAreas",
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

/** How far a soft cut may run past the inner scope before the hard cut. */
export function outerExpandM(route: LatLng[]): number {
  const raw = Math.min(2_000, Math.max(500, 0.125 * diagonalM(route)));
  return Math.round(raw / 50) * 50;
}

/**
 * How far the All hard cut sits outside the query box.
 * The box is already padded around the route, so this is only a thin rim.
 */
export function queryFrameExpandM(route: LatLng[]): number {
  const raw = Math.min(300, Math.max(100, 0.02 * diagonalM(route)));
  return Math.round(raw / 10) * 10;
}

/** Push a ring outward by `padM`. A self-crossing offset keeps the original ring. */
export function expandRing(ring: LngLat[], padM: number): LngLat[] {
  if (ring.length < 3 || padM <= 0) return ring.slice();
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const local = openPts(ring.map(([lng, lat]) => project(lng, lat, lat0)));
  if (local.length < 3) return ring.slice();
  const grown = offsetRing(ensureCcw(local), padM);
  const chosen = segmentsCross(grown) ? local : grown;
  return chosen.map((point) => unproject(point, lat0));
}

export type GeographyCutScope = "corridor" | "ends" | "ring";

export type OuterHardCut =
  | { kind: "ring"; ring: LngLat[] }
  | { kind: "band"; bandM: number | number[] };

/**
 * Keep features that meet the inner scope, then hard-cut them at the further-out limit.
 * Features that miss the inner scope are dropped, even if they sit inside the outer band.
 */
export function clipWaysSoftThenHard<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  route: LatLng[],
  scope: GeographyCutScope,
  options: { corridorM?: number | null; ring?: LngLat[] | null } = {},
): Record<string, T> {
  if (route.length < 2) return ways;
  const expand = outerExpandM(route);
  if (scope === "ends" && options.corridorM != null) {
    const inner = radiusAlongRoute(route, options.corridorM, endRadiusM(options.corridorM));
    return clipWaysToVariableCorridor(
      keepWaysTouchingVariableCorridor(ways, route, inner),
      route,
      inner.map((radius) => radius + expand),
    );
  }
  if (scope === "corridor" && options.corridorM != null) {
    return clipWaysToCorridor(
      keepWaysTouchingCorridor(ways, route, options.corridorM),
      route,
      options.corridorM + expand,
    );
  }
  if (scope === "ring" && options.ring && options.ring.length >= 3) {
    return clipWaysToRing(keepWaysTouchingRing(ways, options.ring), expandRing(options.ring, expand));
  }
  return ways;
}

/** Further-out hard cut of a geography scope. Intersect this with the query frame before masking the satellite. */
export function outerHardCut(
  route: LatLng[],
  scope: GeographyCutScope,
  options: { corridorM?: number | null; ring?: LngLat[] | null } = {},
): OuterHardCut | null {
  if (route.length < 2) return null;
  const expand = outerExpandM(route);
  if (scope === "ring") {
    if (!options.ring || options.ring.length < 3) return null;
    return { kind: "ring", ring: expandRing(options.ring, expand) };
  }
  if (options.corridorM == null) return null;
  if (scope === "ends") {
    const inner = radiusAlongRoute(route, options.corridorM, endRadiusM(options.corridorM));
    return { kind: "band", bandM: inner.map((radius) => radius + expand) };
  }
  return { kind: "band", bandM: options.corridorM + expand };
}

export type FrameGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Cut every geography feature to a rectangle `expandM` outside the query box.
 * Lines stop on that edge. Polygons keep only the overlap, so a lake that
 * continues past the frame becomes the piece inside it.
 * Open coastline is closed along the cut on the water side.
 */
export function clipWaysToQueryFrame<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  bbox: BBox,
  expandM: number,
  inferCoastalWater = true,
): Record<string, T> {
  const ring = queryFrameRing(bbox, expandM);
  const clipped = {} as Record<string, T>;
  for (const [key, bucket] of Object.entries(ways)) {
    const features = ((bucket?.features ?? []) as ExtentFeature[]).flatMap((feature) => clipFeatureToFrame(feature, ring));
    clipped[key] = { ...bucket, features: features as T["features"] };
  }
  const coastal = inferCoastalWater ? coastlineWaterFeatures((ways.coastline?.features ?? []) as ExtentFeature[], ring) : [];
  if (coastal.length) {
    const water = clipped.water ?? ({ features: [] } as unknown as T);
    const features = [...((water.features ?? []) as ExtentFeature[]), ...coastal];
    clipped.water = { ...water, features: features as T["features"] };
  }
  return clipped;
}

/** Cut one geometry to the same frame. Null when nothing remains inside it. */
export function clipGeometryToFrame(geometry: FrameGeometry, bbox: BBox, expandM: number): FrameGeometry | null {
  const ring = queryFrameRing(bbox, expandM);
  const features = clipFeatureToFrame({ geometry }, ring);
  if (!features.length) return null;
  if (features.length === 1) {
    const next = features[0].geometry;
    if (isFrameGeometry(next)) return next;
  }
  const lines = features.flatMap((feature) => linesOf(feature.geometry));
  if (lines.length === 1) return { type: "LineString", coordinates: lines[0] };
  if (lines.length > 1) return { type: "MultiLineString", coordinates: lines };
  return null;
}

/** Axis-aligned box geography is clipped to. The satellite photograph is masked to this ring. */
export function queryFrameRing(bbox: BBox, expandM: number): LngLat[] {
  const frame = padBbox(bbox, Math.max(0, expandM));
  return rectangleRing([frame[0], frame[1]], [frame[2], frame[3]]);
}

function isFrameGeometry(geometry: ExtentFeature["geometry"]): geometry is FrameGeometry {
  const type = geometry?.type;
  return type === "LineString" || type === "MultiLineString" || type === "Polygon" || type === "MultiPolygon";
}

function clipFeatureToFrame(feature: ExtentFeature, ring: LngLat[]): ExtentFeature[] {
  const geometry = feature.geometry;
  if (!geometry?.coordinates) return [];
  const { local, lat0 } = frameLocals(ring);
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const lines = linesOf(geometry)
      .flatMap((line) => clipLineToRing(line, local, lat0))
      .filter((line) => line.length >= 2);
    if (!lines.length) return [];
    if (lines.length === 1) return [{ ...feature, geometry: { type: "LineString", coordinates: lines[0] } }];
    return [{ ...feature, geometry: { type: "MultiLineString", coordinates: lines } }];
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const polygons = geometry.type === "Polygon" ? [asPolygonRings(geometry.coordinates)] : asPolygons(geometry.coordinates);
    const kept = polygons
      .map((rings) => clipPolygonWithHoles(rings, local, lat0))
      .filter((rings) => rings.length > 0);
    if (!kept.length) return [];
    if (kept.length === 1) return [{ ...feature, geometry: { type: "Polygon", coordinates: kept[0] } }];
    return [{ ...feature, geometry: { type: "MultiPolygon", coordinates: kept } }];
  }
  return [];
}

function clipPolygonWithHoles(rings: number[][][], rect: Pt[], lat0: number): number[][][] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  const clippedOuter = closeLngRing(clipPolygonToRing(outer, rect, lat0));
  if (clippedOuter.length < 4) return [];
  const holes = rings.slice(1)
    .map((hole) => closeLngRing(clipPolygonToRing(hole, rect, lat0)))
    .filter((hole) => hole.length >= 4);
  return normalizeWinding([clippedOuter, ...holes], lat0);
}

function closeLngRing(ring: number[][]): number[][] {
  if (ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}

function normalizeWinding(rings: number[][][], lat0: number): number[][][] {
  return rings.map((ring, index) => {
    const local = ring.map(([lng, lat]) => project(lng, lat, lat0));
    const ccw = signedArea(local) >= 0;
    const wantCcw = index === 0;
    const oriented = ccw === wantCcw ? ring : ring.slice().reverse();
    return closeLngRing(oriented);
  });
}

function asPolygonRings(value: unknown): number[][][] {
  return Array.isArray(value) ? (value as number[][][]) : [];
}

type BoundaryHit = { edge: number; t: number; pos: number };
type ShoreChain = { pts: Pt[]; start: BoundaryHit; end: BoundaryHit };

/** Coastline is directed with water on the right. Close it along the frame. */
function coastlineWaterFeatures(features: ExtentFeature[], ring: LngLat[]): ExtentFeature[] {
  const { local, lat0 } = frameLocals(ring);
  const perim = perimeter(local);
  if (perim <= 0) return [];
  const chains: ShoreChain[] = [];
  const landHoles: Pt[][] = [];
  const enclosedWater: Pt[][] = [];
  for (const feature of features) {
    for (const line of linesOf(feature.geometry)) {
      for (const piece of clipLineToRing(line, local, lat0)) {
        const pts = piece.map(([lng, lat]) => project(lng, lat, lat0));
        if (pts.length < 2) continue;
        if (localClosed(pts)) {
          if (signedArea(pts) >= 0) landHoles.push(pts);
          else enclosedWater.push(pts);
          continue;
        }
        const start = locateOnRect(pts[0], local);
        const end = locateOnRect(pts[pts.length - 1], local);
        if (!start || !end) continue;
        chains.push({ pts, start, end });
      }
    }
  }
  const polygons: Pt[][][] = [];
  for (const water of enclosedWater) polygons.push([water]);
  const unused = new Set(chains);
  while (unused.size) {
    const first = unused.values().next().value as ShoreChain;
    unused.delete(first);
    const ccw = shoreWalksCcw(first, local, "right");
    const ringPts = first.pts.slice();
    let cursor = first;
    for (let guard = 0; guard <= chains.length; guard += 1) {
      const back = forwardDistance(cursor.end.pos, first.start.pos, perim, ccw);
      let next: ShoreChain | null = null;
      let nextDist = back;
      for (const chain of unused) {
        const dist = forwardDistance(cursor.end.pos, chain.start.pos, perim, ccw);
        if (dist > 0.5 && dist < nextDist - 0.5) {
          next = chain;
          nextDist = dist;
        }
      }
      const target = next ? next.start : first.start;
      ringPts.push(...boundaryPoints(cursor.end, target, ccw, local, perim));
      if (!next) break;
      unused.delete(next);
      ringPts.push(...next.pts.slice(1));
      cursor = next;
    }
    if (ringPts.length >= 3) polygons.push([ringPts]);
  }
  if (!polygons.length && landHoles.length) {
    const ocean = local.some((corner) => landHoles.every((hole) => !pointInRing(corner, hole)));
    if (ocean) polygons.push([local.slice(), ...landHoles]);
  } else {
    for (const hole of landHoles) {
      const host = polygons.find((polygon) => pointInRing(ringCentroidPt(hole), polygon[0]));
      if (host) host.push(hole);
    }
  }
  return polygons.flatMap((polygon) => {
    const coordinates = normalizeWinding(polygon.map((pts) => pts.map((point) => unproject(point, lat0))), lat0);
    if (coordinates[0].length < 4) return [];
    return [{ type: "Feature", geometry: { type: "Polygon", coordinates }, properties: { tags: { natural: "water" }, geographyClass: "ocean" } }];
  });
}

function shoreWalksCcw(chain: ShoreChain, rect: Pt[], side: "left" | "right"): boolean {
  const prev = chain.pts[chain.pts.length - 2] ?? chain.pts[0];
  const end = chain.pts[chain.pts.length - 1];
  const dx = end.x - prev.x;
  const dy = end.y - prev.y;
  const wx = side === "right" ? dy : -dy;
  const wy = side === "right" ? -dx : dx;
  const ccw = edgeTangent(rect, chain.end.edge, true);
  const cw = edgeTangent(rect, chain.end.edge, false);
  return ccw.x * wx + ccw.y * wy >= cw.x * wx + cw.y * wy;
}

function edgeTangent(rect: Pt[], edge: number, ccw: boolean): Pt {
  const a = rect[edge];
  const b = rect[(edge + 1) % rect.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const x = (b.x - a.x) / len;
  const y = (b.y - a.y) / len;
  return ccw ? { x, y } : { x: -x, y: -y };
}

function locateOnRect(point: Pt, rect: Pt[]): BoundaryHit | null {
  const lens = edgeLengths(rect);
  let offset = 0;
  let best: BoundaryHit | null = null;
  let bestDist = 3;
  for (let i = 0; i < rect.length; i += 1) {
    const a = rect[i];
    const b = rect[(i + 1) % rect.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    const dist = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    if (dist < bestDist) {
      bestDist = dist;
      best = { edge: i, t, pos: offset + t * lens[i] };
    }
    offset += lens[i];
  }
  return best;
}

function edgeLengths(rect: Pt[]): number[] {
  return rect.map((point, index) => {
    const next = rect[(index + 1) % rect.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
}

function perimeter(rect: Pt[]): number {
  return edgeLengths(rect).reduce((sum, length) => sum + length, 0);
}

function cornerPositions(rect: Pt[]): number[] {
  const lens = edgeLengths(rect);
  const positions: number[] = [];
  let offset = 0;
  for (const length of lens) {
    offset += length;
    positions.push(offset);
  }
  return positions;
}

function forwardDistance(from: number, to: number, perim: number, ccw: boolean): number {
  if (perim <= 0) return 0;
  return ccw ? (to - from + perim) % perim : (from - to + perim) % perim;
}

function boundaryPoints(from: BoundaryHit, to: BoundaryHit, ccw: boolean, rect: Pt[], perim: number): Pt[] {
  const dist = forwardDistance(from.pos, to.pos, perim, ccw);
  if (dist < 0.5) return [];
  const corners = cornerPositions(rect);
  const hits: Array<{ pos: number; point: Pt }> = [];
  for (let i = 0; i < rect.length; i += 1) {
    const along = forwardDistance(from.pos, corners[i] % perim, perim, ccw);
    if (along > 0.5 && along < dist - 0.5) hits.push({ pos: along, point: rect[(i + 1) % rect.length] });
  }
  hits.sort((a, b) => a.pos - b.pos);
  return hits.map((hit) => hit.point);
}

function localClosed(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 1;
}

function ringCentroidPt(ring: Pt[]): Pt {
  const limit = localClosed(ring) ? ring.length - 1 : ring.length;
  let x = 0;
  let y = 0;
  for (let i = 0; i < limit; i += 1) {
    x += ring[i].x;
    y += ring[i].y;
  }
  return { x: x / limit, y: y / limit };
}

function frameLocals(ring: LngLat[]): { local: Pt[]; lat0: number } {
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const local = ensureCcw(openPts(ring.map(([lng, lat]) => project(lng, lat, lat0))));
  return { local, lat0 };
}

/** Hard-cut every feature to `ring`, dropping anything that misses it. */
export function clipWaysToRing<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  ring: LngLat[],
): Record<string, T> {
  if (ring.length < 3) return ways;
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const localRing = ensureCcw(openPts(ring.map(([lng, lat]) => project(lng, lat, lat0))));
  const polygonClips = convexPieces(localRing);
  const clipped = {} as Record<string, T>;
  for (const [key, bucket] of Object.entries(ways)) {
    const features = ((bucket?.features ?? []) as ExtentFeature[]).flatMap((feature) =>
      clipFeatureToRing(feature, localRing, polygonClips, lat0),
    );
    clipped[key] = { ...bucket, features: features as T["features"] };
  }
  return clipped;
}

export function clipWaysWiderAtEnds<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  route: LatLng[],
  midM: number,
): Record<string, T> {
  return clipWaysToVariableCorridor(ways, route, radiusAlongRoute(route, midM, endRadiusM(midM)));
}

/** Keep each feature whole when any part of it meets the ring. */
export function keepWaysTouchingRing<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  ring: LngLat[],
): Record<string, T> {
  if (ring.length < 3) return ways;
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const localRing = ring.map(([lng, lat]) => project(lng, lat, lat0));
  const kept = {} as Record<string, T>;
  for (const [key, bucket] of Object.entries(ways)) {
    const features = ((bucket?.features ?? []) as ExtentFeature[]).filter((feature) =>
      geometryTouchesRing(feature.geometry, localRing, lat0),
    );
    kept[key] = { ...bucket, features: features as T["features"] };
  }
  return kept;
}

function geometryTouchesRing(
  geometry: ExtentFeature["geometry"],
  ring: Pt[],
  lat0: number,
): boolean {
  if (!geometry?.coordinates) return false;
  if (geometry.type === "Point") {
    const point = asPoint(geometry.coordinates);
    return point ? pointInRing(project(point[0], point[1], lat0), ring) : false;
  }
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    return linesOf(geometry).some((line) => polylineTouches(line.map(([lng, lat]) => project(lng, lat, lat0)), ring));
  }
  return outerRings(geometry).some((outer) => {
    const local = openRing(outer).map(([lng, lat]) => project(lng, lat, lat0));
    return local.length >= 3 && polygonTouches(local, ring);
  });
}

function polylineTouches(line: Pt[], ring: Pt[]): boolean {
  if (line.some((point) => pointInRing(point, ring))) return true;
  return edgesCross(line, ring, false);
}

function polygonTouches(polygon: Pt[], ring: Pt[]): boolean {
  if (polygon.some((point) => pointInRing(point, ring))) return true;
  if (ring.some((point) => pointInRing(point, polygon))) return true;
  return edgesCross(polygon, ring, true);
}

function edgesCross(a: Pt[], b: Pt[], closeA: boolean): boolean {
  const aCount = closeA ? a.length : a.length - 1;
  for (let i = 0; i < aCount; i += 1) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (properCross(a0, a1, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

function linesOf(geometry: ExtentFeature["geometry"]): number[][][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "LineString") return [asLine(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return asLines(geometry.coordinates);
  return [];
}

function asPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = value[0];
  const lat = value[1];
  return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
}

function asLine(value: unknown): number[][] {
  return Array.isArray(value) ? (value as number[][]) : [];
}

function asLines(value: unknown): number[][][] {
  return Array.isArray(value) ? (value as number[][][]) : [];
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

function openPts(points: Pt[]): Pt[] {
  if (points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 1) {
    return points.slice(0, -1);
  }
  return points;
}

function clipFeatureToRing(feature: ExtentFeature, ring: Pt[], polygonClips: Pt[][], lat0: number): ExtentFeature[] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const lines = linesOf(geometry)
      .flatMap((line) => clipLineToRing(line, ring, lat0))
      .filter((line) => line.length >= 2);
    if (!lines.length) return [];
    return lines.map((line) => ({ ...feature, geometry: { type: "LineString", coordinates: line } }));
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const polygons = geometry.type === "Polygon"
      ? [asPolygonRings(geometry.coordinates)]
      : asPolygons(geometry.coordinates);
    return polygons.flatMap((polygon) => polygonClips.flatMap((clip) => {
      const clipped = clipPolygonWithHoles(polygon, clip, lat0);
      return clipped.length ? [{ ...feature, geometry: { type: "Polygon", coordinates: clipped } }] : [];
    }));
  }
  return [];
}

function clipLineToRing(line: number[][], ring: Pt[], lat0: number): number[][][] {
  const local: Pt[] = [];
  for (const point of line) {
    const coords = asPoint(point);
    if (!coords) continue;
    const [lng, lat] = coords;
    local.push(project(lng, lat, lat0));
  }
  const pieces: number[][][] = [];
  let current: number[][] = [];
  let previous: Pt | null = null;
  let previousInside = false;
  const push = (point: Pt) => {
    const [lng, lat] = unproject(point, lat0);
    current.push([lng, lat]);
  };
  const finish = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (const point of local) {
    const inside = pointInRing(point, ring);
    if (previous && !previousInside && !inside) {
      const hits = segmentHits(previous, point, ring);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        push(hits[i]);
        push(hits[i + 1]);
        finish();
      }
    } else if (previous && inside !== previousInside) {
      const hit = ringHit(previous, point, ring);
      if (hit) push(hit);
      if (!inside) finish();
    }
    if (inside) push(point);
    previous = point;
    previousInside = inside;
  }
  finish();
  return pieces;
}

function clipPolygonToRing(shape: number[][], ring: Pt[], lat0: number): number[][] {
  const projected: Pt[] = [];
  for (const point of shape) {
    const coords = asPoint(point);
    if (!coords) continue;
    const [lng, lat] = coords;
    projected.push(project(lng, lat, lat0));
  }
  let output = openPts(projected);
  if (output.length < 3) return [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j];
      const prior = input[(j + input.length - 1) % input.length];
      const currentIn = leftOf(a, b, current);
      const priorIn = leftOf(a, b, prior);
      if (currentIn) {
        if (!priorIn) {
          const hit = lineCross(prior, current, a, b);
          if (hit) output.push(hit);
        }
        output.push(current);
      } else if (priorIn) {
        const hit = lineCross(prior, current, a, b);
        if (hit) output.push(hit);
      }
    }
    if (output.length < 3) return [];
  }
  return output.map((point) => unproject(point, lat0));
}

/** The polygon clipper uses half-planes, so split concave extents into convex pieces first. */
function convexPieces(ring: Pt[]): Pt[][] {
  const vertices = ring.filter((point, index) => {
    const prev = ring[(index + ring.length - 1) % ring.length];
    const next = ring[(index + 1) % ring.length];
    return Math.abs((point.x - prev.x) * (next.y - point.y) - (point.y - prev.y) * (next.x - point.x)) > 1e-6;
  });
  if (vertices.length < 3) return [];
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (vertices.every((point, index) => cross(point, vertices[(index + 1) % vertices.length], vertices[(index + 2) % vertices.length]) >= -1e-6)) {
    return [vertices];
  }
  const remaining = vertices.slice();
  const triangles: Pt[][] = [];
  while (remaining.length > 3) {
    let ear = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i];
      const c = remaining[(i + 1) % remaining.length];
      if (cross(a, b, c) <= 1e-6) continue;
      const containsVertex = remaining.some((point, index) => {
        if (index === i || index === (i + 1) % remaining.length || index === (i + remaining.length - 1) % remaining.length) return false;
        return cross(a, b, point) >= -1e-6 && cross(b, c, point) >= -1e-6 && cross(c, a, point) >= -1e-6;
      });
      if (!containsVertex) { ear = i; break; }
    }
    if (ear < 0) return [vertices];
    const a = remaining[(ear + remaining.length - 1) % remaining.length];
    const b = remaining[ear];
    const c = remaining[(ear + 1) % remaining.length];
    triangles.push([a, b, c]);
    remaining.splice(ear, 1);
  }
  triangles.push(remaining);
  return triangles;
}

/** Where segment ab crosses the infinite line through cd. */
function lineCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denom;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function segmentHits(a: Pt, b: Pt, ring: Pt[]): Pt[] {
  const hits: Array<{ point: Pt; dist: number }> = [];
  for (let i = 0; i < ring.length; i += 1) {
    const hit = edgeHit(a, b, ring[i], ring[(i + 1) % ring.length]);
    if (!hit) continue;
    hits.push({ point: hit, dist: Math.hypot(hit.x - a.x, hit.y - a.y) });
  }
  hits.sort((left, right) => left.dist - right.dist);
  const unique: Pt[] = [];
  for (const hit of hits) {
    const prev = unique[unique.length - 1];
    if (prev && Math.hypot(prev.x - hit.point.x, prev.y - hit.point.y) < 0.5) continue;
    unique.push(hit.point);
  }
  return unique;
}

function ringHit(a: Pt, b: Pt, ring: Pt[]): Pt | null {
  let best: Pt | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const hit = edgeHit(a, b, ring[i], ring[(i + 1) % ring.length]);
    if (!hit) continue;
    const dist = Math.hypot(hit.x - a.x, hit.y - a.y);
    if (dist < bestDist) {
      best = hit;
      bestDist = dist;
    }
  }
  return best;
}

function edgeHit(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denom;
  const u = ((a.x - c.x) * (a.y - b.y) - (a.y - c.y) * (a.x - b.x)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function leftOf(a: Pt, b: Pt, point: Pt): boolean {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= 0;
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
