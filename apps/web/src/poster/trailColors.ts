/**
 * Private trail index swatches. Keep names common (models match words to pixels)
 * and hues/values far from each other and from route red, road grey, water blue,
 * forest green, and region ochre. Sync with apps/api/src/trailColors.ts.
 */
export const TRAIL_SWATCHES = [
  { name: "teal", hex: "#0d9488" },
  { name: "amber", hex: "#d97706" },
  { name: "violet", hex: "#7c3aed" },
  { name: "sky", hex: "#0284c7" },
  { name: "magenta", hex: "#c026d3" },
  { name: "olive", hex: "#65a30d" },
  { name: "coral", hex: "#ea580c" },
  { name: "indigo", hex: "#4f46e5" },
  { name: "yellow", hex: "#eab308" },
  { name: "lime", hex: "#84cc16" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "rose", hex: "#e11d48" },
  { name: "brown", hex: "#9a3412" },
  { name: "navy", hex: "#1e3a8a" },
  { name: "pink", hex: "#db2777" },
  { name: "plum", hex: "#6b21a8" },
] as const;

export const ON_NAMED_TRAIL_M = 100;

export type TrailSwatch = (typeof TRAIL_SWATCHES)[number];

export function assignTrailColors<T extends { name: string }>(
  trails: T[],
): Array<T & { colorName: string; color: string }> {
  return trails.map((trail, index) => {
    const swatch = TRAIL_SWATCHES[index % TRAIL_SWATCHES.length];
    return { ...trail, colorName: swatch.name, color: swatch.hex };
  });
}

/**
 * One color per GPS vertex. Earlier trails win when two names cover the same
 * stretch. Null means the unnamed red track. User-defined `routeSpans` color only
 * those indexes; an empty array does not fall back to distance.
 */
export function routeVertexColors(
  latlng: [number, number][],
  trails: Array<{
    color: string;
    geometry: { coordinates: number[][][] };
    routeSpans?: Array<{ start: number; end: number }>;
  }>,
  maxM = ON_NAMED_TRAIL_M,
): Array<string | null> {
  const colors: Array<string | null> = latlng.map(() => null);
  for (let t = trails.length - 1; t >= 0; t -= 1) {
    const trail = trails[t];
    if (trail.routeSpans !== undefined) {
      paintSpans(colors, trail.color, trail.routeSpans);
      continue;
    }
    for (let i = 0; i < latlng.length; i += 1) {
      if (distToTrailM(latlng[i], trail.geometry.coordinates) <= maxM) {
        colors[i] = trail.color;
      }
    }
  }
  return colors;
}

/** First selected trail covering the point, or null if the GPS is unnamed. */
export function nearestTrailName(
  point: [number, number],
  trails: Array<{
    name: string;
    geometry: { coordinates: number[][][] };
    routeSpans?: Array<{ start: number; end: number }>;
  }>,
  maxM = ON_NAMED_TRAIL_M,
  route?: [number, number][],
): string | null {
  const index = route?.length ? nearestRouteIndex(point, route) : -1;
  for (const trail of trails) {
    if (trail.routeSpans !== undefined) {
      if (index >= 0 && spansContain(trail.routeSpans, index)) return trail.name;
      continue;
    }
    if (distToTrailM(point, trail.geometry.coordinates) <= maxM) return trail.name;
  }
  return null;
}

function paintSpans(
  colors: Array<string | null>,
  color: string,
  spans: Array<{ start: number; end: number }>,
) {
  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start, span.end));
    const end = Math.min(colors.length - 1, Math.max(span.start, span.end));
    for (let i = start; i <= end; i += 1) colors[i] = color;
  }
}

function spansContain(spans: Array<{ start: number; end: number }>, index: number) {
  return spans.some((span) => index >= Math.min(span.start, span.end) && index <= Math.max(span.start, span.end));
}

function nearestRouteIndex(point: [number, number], route: [number, number][]): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i += 1) {
    const d = distToSegmentM(point, route[i], route[i]);
    if (d >= bestD) continue;
    bestD = d;
    best = i;
  }
  return best;
}

function distToTrailM(point: [number, number], lines: number[][][]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (a.length < 2 || b.length < 2) continue;
      const d = distToSegmentM(point, [a[1], a[0]], [b[1], b[0]]);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

function distToSegmentM(
  point: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [lat, lng] = point;
  const midLat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const kx = 111_320 * Math.max(0.2, Math.abs(Math.cos(midLat)));
  const ky = 111_320;
  const ax = a[1] * kx;
  const ay = a[0] * ky;
  const bx = b[1] * kx;
  const by = b[0] * ky;
  const px = lng * kx;
  const py = lat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.hypot(x, y);
}
