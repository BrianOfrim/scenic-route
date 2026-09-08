const PLACE_KINDS = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "quarter",
  "neighbourhood",
  "locality",
]);

const AREA_PLACE_KINDS = new Set(["quarter", "neighbourhood"]);

/** Closest settlement or neighbourhood to a GPS point. */
export function nearestPlaceName(
  pois: Array<{ name: string; kind: string; lat: number; lng: number }>,
  areas: Array<{ name: string; kind: string; lat: number; lng: number }>,
  point: [number, number],
): string {
  const places = [
    ...pois.filter((poi) => PLACE_KINDS.has(poi.kind)),
    ...areas.filter((area) => AREA_PLACE_KINDS.has(area.kind)),
  ];
  if (!places.length) return "";
  let best = places[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const place of places) {
    const dist = (place.lat - point[0]) ** 2 + (place.lng - point[1]) ** 2;
    if (dist < bestDist) {
      best = place;
      bestDist = dist;
    }
  }
  return best.name;
}
