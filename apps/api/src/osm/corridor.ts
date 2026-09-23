/** Route corridor for geography on the schematic. */

export const CORRIDOR_MIN_M = 200;
export const CORRIDOR_FLOOR_M = 300;
export const CORRIDOR_CAP_M = 2_000;
export const CORRIDOR_FRACTION = 0.08;
export const CORRIDOR_STEP_M = 50;

const EARTH_M = 6_371_000;
const M_PER_DEG = 111_320;

export type LatLng = [number, number];
export type BBox = [number, number, number, number];

export type CorridorSettings = {
  /** Slider default for this route. */
  meters: number;
  minM: number;
  /** Geometry is clipped to this width so the slider can tighten without another map query. */
  maxM: number;
};

type Pt = { x: number; y: number };
type Ring = Pt[];

type CorridorGeometry = {
  type: string;
  coordinates: unknown;
};

type CorridorFeature = {
  type?: string;
  geometry?: CorridorGeometry | null;
  properties?: unknown;
  [key: string]: unknown;
};

export function defaultCorridorM(route: LatLng[], loop: boolean): number {
  if (route.length < 2) return CORRIDOR_FLOOR_M;
  const bbox = bboxOf(route);
  const scaled = Math.min(CORRIDOR_CAP_M, Math.max(CORRIDOR_FLOOR_M, CORRIDOR_FRACTION * diagonalM(bbox)));
  const meters = loop ? Math.max(scaled, shorterSideM(bbox) / 2) : scaled;
  return snapCorridor(meters, CORRIDOR_MIN_M, Number.POSITIVE_INFINITY);
}

export function corridorLimitM(meters: number): number {
  return snapCorridor(Math.max(CORRIDOR_CAP_M, meters), CORRIDOR_MIN_M, Number.POSITIVE_INFINITY);
}

export function corridorForRoute(route: LatLng[], loop: boolean): CorridorSettings {
  const meters = defaultCorridorM(route, loop);
  return { meters, minM: CORRIDOR_MIN_M, maxM: corridorLimitM(meters) };
}

export function formatCorridorM(meters: number): string {
  if (meters >= 1_000) {
    const km = meters / 1_000;
    const text = km >= 10 || Math.abs(km - Math.round(km)) < 0.05 ? String(Math.round(km)) : km.toFixed(1);
    return `${text} km`;
  }
  return `${Math.round(meters)} m`;
}

export function clipWaysToCorridor<T extends { features?: unknown[] }>(
  ways: Record<string, T>,
  route: LatLng[],
  radiusM: number,
): Record<string, T> {
  if (route.length < 2 || !Number.isFinite(radiusM) || radiusM <= 0) return ways;
  const index = new RouteIndex(route, radiusM);
  const clipped = {} as Record<string, T>;
  for (const [key, bucket] of Object.entries(ways)) {
    const features = (bucket?.features ?? []).flatMap((feature) => clipFeature(feature as CorridorFeature, index, radiusM));
    clipped[key] = { ...bucket, features: features as T["features"] };
  }
  return clipped;
}

function snapCorridor(meters: number, minM: number, maxM: number): number {
  const snapped = Math.round(meters / CORRIDOR_STEP_M) * CORRIDOR_STEP_M;
  return Math.min(maxM, Math.max(minM, snapped));
}

function bboxOf(route: LatLng[]): BBox {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  for (const [lat, lng] of route) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function diagonalM(bbox: BBox): number {
  return haversineM([bbox[1], bbox[0]], [bbox[3], bbox[2]]);
}

function shorterSideM(bbox: BBox): number {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const height = Math.abs(bbox[3] - bbox[1]) * M_PER_DEG;
  const width = Math.abs(bbox[2] - bbox[0]) * M_PER_DEG * Math.max(0.2, Math.abs(Math.cos((midLat * Math.PI) / 180)));
  return Math.min(height, width);
}

function haversineM(a: LatLng, b: LatLng): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function project(lng: number, lat: number, lat0: number): Pt {
  const cos = Math.cos((lat0 * Math.PI) / 180);
  return { x: lng * M_PER_DEG * cos, y: lat * M_PER_DEG };
}

function unproject(point: Pt, lat0: number): [number, number] {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 1;
  return [point.x / (M_PER_DEG * cos), point.y / M_PER_DEG];
}

class RouteIndex {
  readonly lat0: number;
  readonly radius: number;
  private readonly segments: Array<{ a: Pt; b: Pt }> = [];
  private readonly grid = new Map<string, number[]>();
  private readonly cell: number;
  private readonly capsules: Ring[];

  constructor(route: LatLng[], radius: number) {
    this.radius = radius;
    this.cell = Math.max(50, radius);
    const lat0 = route.reduce((sum, point) => sum + point[0], 0) / route.length;
    this.lat0 = lat0;
    const local = route.map(([lat, lng]) => project(lng, lat, lat0));
    const indexed = simplify(local, 20, 800);
    for (let i = 1; i < indexed.length; i += 1) {
      const a = indexed[i - 1];
      const b = indexed[i];
      if (hypot(a, b) < 0.5) continue;
      const id = this.segments.length;
      this.segments.push({ a, b });
      this.cover(a, b, id);
    }
    const spine = simplify(local, Math.max(30, radius / 6), 180);
    this.capsules = [];
    for (let i = 1; i < spine.length; i += 1) {
      const a = spine[i - 1];
      const b = spine[i];
      this.capsules.push(hypot(a, b) < 1 ? circle(a, radius, 10) : stadium(a, b, radius, 5));
    }
    if (!this.capsules.length && local.length) this.capsules.push(circle(local[0], radius, 10));
  }

  distance(point: Pt): number {
    const reach = this.radius + this.cell;
    const minX = Math.floor((point.x - reach) / this.cell);
    const maxX = Math.floor((point.x + reach) / this.cell);
    const minY = Math.floor((point.y - reach) / this.cell);
    const maxY = Math.floor((point.y + reach) / this.cell);
    let best = Number.POSITIVE_INFINITY;
    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        const hits = this.grid.get(`${ix}:${iy}`);
        if (!hits) continue;
        for (const id of hits) {
          const segment = this.segments[id];
          const dist = segmentDistance(point, segment.a, segment.b);
          if (dist < best) best = dist;
        }
      }
    }
    return best;
  }

  clipPolygon(rings: Ring[]): Ring[][] {
    const outer = rings[0];
    if (!outer || outer.length < 3) return [];
    const bounds = ringBounds(outer);
    if (!this.boundsMeet(bounds)) return [];
    if (this.ringInside(outer)) return [rings.map((ring) => ring.slice())];
    const outline = simplify(dedupe(outer), Math.max(15, this.radius / 8), 220);
    const pieces: Ring[][] = [];
    for (const capsule of this.capsules) {
      if (!boundsOverlap(bounds, ringBounds(capsule), 0)) continue;
      const clipped = clipConvex(outline, capsule);
      if (clipped.length < 3 || Math.abs(signedArea(clipped)) < 250) continue;
      pieces.push([clipped]);
    }
    return pieces;
  }

  private ringInside(ring: Ring): boolean {
    const bounds = ringBounds(ring);
    const span = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    if (span > this.radius) return false;
    const limit = this.radius - span / 2;
    return ring.every((point) => this.distance(point) <= limit);
  }

  private boundsMeet(bounds: Bounds): boolean {
    const reach = this.radius;
    const minX = Math.floor((bounds.minX - reach) / this.cell);
    const maxX = Math.floor((bounds.maxX + reach) / this.cell);
    const minY = Math.floor((bounds.minY - reach) / this.cell);
    const maxY = Math.floor((bounds.maxY + reach) / this.cell);
    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        if (this.grid.has(`${ix}:${iy}`)) return true;
      }
    }
    return false;
  }

  private cover(a: Pt, b: Pt, id: number) {
    const minX = Math.floor(Math.min(a.x, b.x) / this.cell);
    const maxX = Math.floor(Math.max(a.x, b.x) / this.cell);
    const minY = Math.floor(Math.min(a.y, b.y) / this.cell);
    const maxY = Math.floor(Math.max(a.y, b.y) / this.cell);
    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iy = minY; iy <= maxY; iy += 1) {
        const key = `${ix}:${iy}`;
        const list = this.grid.get(key);
        if (list) list.push(id);
        else this.grid.set(key, [id]);
      }
    }
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function clipFeature(feature: CorridorFeature, index: RouteIndex, radius: number): CorridorFeature[] {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    const lines = clipLine(asLine(geometry.coordinates), index, radius);
    return lines.map((line) => ({ ...feature, geometry: { type: "LineString", coordinates: line } }));
  }
  if (geometry.type === "MultiLineString") {
    const lines = asLines(geometry.coordinates).flatMap((line) => clipLine(line, index, radius));
    if (!lines.length) return [];
    if (lines.length === 1) return [{ ...feature, geometry: { type: "LineString", coordinates: lines[0] } }];
    return [{ ...feature, geometry: { type: "MultiLineString", coordinates: lines } }];
  }
  if (geometry.type === "Polygon") {
    return polygonPieces(feature, asRings(geometry.coordinates), index);
  }
  if (geometry.type === "MultiPolygon") {
    const pieces = asPolygons(geometry.coordinates).flatMap((rings) => index.clipPolygon(toLocalRings(rings, index.lat0)));
    if (!pieces.length) return [];
    const coordinates = pieces.map((rings) => fromLocalRings(rings, index.lat0));
    if (coordinates.length === 1) return [{ ...feature, geometry: { type: "Polygon", coordinates: coordinates[0] } }];
    return [{ ...feature, geometry: { type: "MultiPolygon", coordinates } }];
  }
  if (geometry.type === "Point") {
    const point = asPoint(geometry.coordinates);
    if (!point) return [];
    const local = project(point[0], point[1], index.lat0);
    return index.distance(local) <= radius ? [feature] : [];
  }
  return [feature];
}

function polygonPieces(feature: CorridorFeature, rings: number[][][], index: RouteIndex): CorridorFeature[] {
  const pieces = index.clipPolygon(toLocalRings(rings, index.lat0));
  if (!pieces.length) return [];
  const coordinates = pieces.map((piece) => fromLocalRings(piece, index.lat0));
  if (coordinates.length === 1) return [{ ...feature, geometry: { type: "Polygon", coordinates: coordinates[0] } }];
  return [{ ...feature, geometry: { type: "MultiPolygon", coordinates } }];
}

function clipLine(line: number[][], index: RouteIndex, radius: number): number[][][] {
  if (line.length < 2) return [];
  const local = line.map(([lng, lat]) => project(lng, lat, index.lat0));
  const step = Math.max(25, radius / 5);
  const samples: Pt[] = [local[0]];
  for (let i = 1; i < local.length; i += 1) {
    const a = local[i - 1];
    const b = local[i];
    const count = Math.max(1, Math.ceil(hypot(a, b) / step));
    for (let s = 1; s <= count; s += 1) {
      const t = s / count;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const inside = samples.map((point) => index.distance(point) <= radius);
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (inside[i]) {
      if (!run.length && i > 0) run.push(boundary(samples[i - 1], samples[i], index, radius));
      run.push(samples[i]);
      continue;
    }
    if (!run.length) continue;
    run.push(boundary(samples[i], samples[i - 1], index, radius));
    if (run.length >= 2) runs.push(simplify(run, 12, 400));
    run = [];
  }
  if (run.length >= 2) runs.push(simplify(run, 12, 400));
  return runs
    .map((points) => points.map((point) => unproject(point, index.lat0)))
    .filter((points) => points.length >= 2);
}

function boundary(outside: Pt, inside: Pt, index: RouteIndex, radius: number): Pt {
  let lo = outside;
  let hi = inside;
  for (let i = 0; i < 14; i += 1) {
    const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
    if (index.distance(mid) <= radius) hi = mid;
    else lo = mid;
  }
  return hi;
}

function toLocalRings(rings: number[][][], lat0: number): Ring[] {
  return rings.map((ring) => openRing(ring).map(([lng, lat]) => project(lng, lat, lat0)));
}

function fromLocalRings(rings: Ring[], lat0: number): number[][][] {
  return rings.map((ring) => {
    const coords = ring.map((point) => unproject(point, lat0));
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
    return coords;
  });
}

function openRing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let output = dedupe(subject);
  if (signedArea(clip) < 0) clip = clip.slice().reverse();
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j += 1) {
      const start = input[j];
      const end = input[(j + 1) % input.length];
      const startIn = leftOf(start, a, b);
      const endIn = leftOf(end, a, b);
      if (startIn && endIn) output.push(end);
      else if (startIn && !endIn) output.push(segmentHit(start, end, a, b));
      else if (!startIn && endIn) {
        output.push(segmentHit(start, end, a, b));
        output.push(end);
      }
    }
    output = dedupe(output);
  }
  return output;
}

function leftOf(point: Pt, a: Pt, b: Pt): boolean {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -1e-6;
}

function segmentHit(start: Pt, end: Pt, a: Pt, b: Pt): Pt {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return end;
  const t = ((a.x - start.x) * ey - (a.y - start.y) * ex) / den;
  const clamped = Math.max(0, Math.min(1, t));
  return { x: start.x + clamped * dx, y: start.y + clamped * dy };
}

function stadium(a: Pt, b: Pt, radius: number, steps: number): Pt[] {
  const len = hypot(a, b);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const px = -uy;
  const py = ux;
  const points: Pt[] = [];
  const startB = Math.atan2(py, px);
  for (let i = 0; i <= steps; i += 1) {
    const angle = startB - (i / steps) * Math.PI;
    points.push({ x: b.x + Math.cos(angle) * radius, y: b.y + Math.sin(angle) * radius });
  }
  const startA = Math.atan2(-py, -px);
  for (let i = 0; i <= steps; i += 1) {
    const angle = startA - (i / steps) * Math.PI;
    points.push({ x: a.x + Math.cos(angle) * radius, y: a.y + Math.sin(angle) * radius });
  }
  return points;
}

function circle(center: Pt, radius: number, steps: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return points;
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

function segmentDistance(point: Pt, a: Pt, b: Pt): number {
  return Math.sqrt(pointSegmentDistance2(point, a, b));
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
    if (prev && Math.abs(prev.x - point.x) < 0.05 && Math.abs(prev.y - point.y) < 0.05) continue;
    next.push(point);
  }
  if (next.length > 2) {
    const first = next[0];
    const last = next[next.length - 1];
    if (Math.abs(first.x - last.x) < 0.05 && Math.abs(first.y - last.y) < 0.05) next.pop();
  }
  return next;
}

function ringBounds(ring: Pt[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a: Bounds, b: Bounds, pad: number): boolean {
  return a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY;
}

function hypot(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function asLine(value: unknown): number[][] {
  return Array.isArray(value) ? (value as number[][]) : [];
}

function asLines(value: unknown): number[][][] {
  return Array.isArray(value) ? (value as number[][][]) : [];
}

function asRings(value: unknown): number[][][] {
  return Array.isArray(value) ? (value as number[][][]) : [];
}

function asPolygons(value: unknown): number[][][][] {
  return Array.isArray(value) ? (value as number[][][][]) : [];
}

function asPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return [Number(value[0]), Number(value[1])];
}
