import { haversineM, type LatLng } from "./geo";

export type TrackPoint = { lat: number; lng: number; time: Date | null };
export type SegmentedTrack<T extends TrackPoint> = { points: T[]; breaks: number[] };

const JOIN_M = 75;

/** Keep chronological recordings in order; untimed map relations may need their ways reoriented. */
export function stitchTrackSegments<T extends TrackPoint>(input: T[][]): SegmentedTrack<T> {
  const segments = input.filter((segment) => segment.length > 0);
  if (!segments.length) return { points: [], breaks: [] };
  const timed = segments.some((segment) => segment.some((point) => point.time != null));
  const unused = new Set(segments.map((_, index) => index));
  const points: T[] = [];
  const breaks: number[] = [];
  let last: T | null = null;

  while (unused.size) {
    let next = -1;
    let reverse = false;
    let join = false;
    if (last && !timed) {
      let nearest = JOIN_M;
      for (const index of unused) {
        const segment = segments[index];
        for (const candidate of [false, true]) {
          const endpoint = candidate ? segment[segment.length - 1] : segment[0];
          const distance = haversineM([last.lat, last.lng], [endpoint.lat, endpoint.lng]);
          if (distance < nearest) { nearest = distance; next = index; reverse = candidate; join = true; }
        }
      }
    }
    if (next < 0) {
      next = unused.values().next().value!;
      if (!timed && unused.size > 1) {
        for (const index of unused) {
          const segment = segments[index];
          const firstOpen = !hasNeighbor(segment[0], index, segments, unused);
          const lastOpen = !hasNeighbor(segment[segment.length - 1], index, segments, unused);
          if (firstOpen !== lastOpen) {
            next = index;
            reverse = lastOpen;
            break;
          }
        }
      }
      if (last && timed) {
        const start = segments[next][0];
        const elapsedS = last.time && start.time
          ? (start.time.getTime() - last.time.getTime()) / 1000 : 0;
        const maxJoinM = elapsedS > 0 ? Math.max(JOIN_M, Math.min(500, elapsedS * 20)) : JOIN_M;
        join = haversineM([last.lat, last.lng], [start.lat, start.lng]) <= maxJoinM;
      }
    }
    if (points.length && !join) breaks.push(points.length);
    const segment = reverse ? [...segments[next]].reverse() : segments[next];
    points.push(...segment);
    last = segment[segment.length - 1];
    unused.delete(next);
  }
  return { points, breaks };
}

function hasNeighbor<T extends TrackPoint>(
  endpoint: T, self: number, segments: T[][], unused: ReadonlySet<number>,
): boolean {
  for (const index of unused) {
    if (index === self) continue;
    const segment = segments[index];
    for (const other of [segment[0], segment[segment.length - 1]]) {
      if (haversineM([endpoint.lat, endpoint.lng], [other.lat, other.lng]) <= JOIN_M) return true;
    }
  }
  return false;
}

export function trackDistanceWithBreaks(latlng: LatLng[], breaks: readonly number[] = []): number {
  const start = new Set(breaks);
  let total = 0;
  for (let i = 1; i < latlng.length; i += 1) {
    if (!start.has(i)) total += haversineM(latlng[i - 1], latlng[i]);
  }
  return total;
}

export function remapTrackBreaks(breaks: readonly number[], sourceIndexes: readonly number[]): number[] {
  return breaks.map((start) => sourceIndexes.findIndex((index) => index >= start)).filter((index) => index > 0);
}
