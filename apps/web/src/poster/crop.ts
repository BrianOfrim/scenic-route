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

export function trackDistanceM(latlng: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < latlng.length; i += 1) {
    total += haversineM(latlng[i - 1], latlng[i]);
  }
  return total;
}

export function paddedBbox(
  latlng: [number, number][],
  extras: Array<{ lat: number; lng: number }> = [],
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
  const padM = Math.min(5_000, Math.max(400, 0.15 * diagonal));
  const midLat = (minLat + maxLat) / 2;
  const dlat = padM / 111_320;
  const dlng = padM / (111_320 * Math.max(0.2, Math.abs(Math.cos((midLat * Math.PI) / 180))));
  return [
    [minLng - dlng, minLat - dlat],
    [maxLng + dlng, maxLat + dlat],
  ];
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
