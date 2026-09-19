export type FeatureOption = {
  id: string;
  label: string;
  group: "geography" | "landmarks";
  defaultOn: boolean;
  nearRouteM?: number;
};

export const DEFAULT_NEAR_ROUTE_M = 100;
export const BEACH_NEAR_ROUTE_M = 500;
export const TOWN_NEAR_ROUTE_M = 1_000;
export const MAX_NEAR_ROUTE_M = 20_000;

const LANDMARK_KINDS: Record<string, string[]> = {
  peaks: ["peak"],
  towns: ["city", "town", "village", "hamlet", "suburb", "locality"],
  neighbourhoods: ["neighbourhood", "quarter"],
  "named-water": ["water", "bay", "beach", "river", "waterfall"],
  "strava-segments": ["trail"],
  viewpoints: ["viewpoint", "attraction", "castle"],
  historic: [
    "historic",
    "memorial",
    "monument",
    "ruins",
    "archaeological_site",
    "wayside_cross",
    "wayside_shrine",
    "battlefield",
    "fort",
    "manor",
    "wreck",
    "tomb",
  ],
  "named-parks": ["park", "nature_reserve"],
  structures: ["lighthouse", "tower", "bridge", "windmill"],
  food: ["cafe", "pub", "restaurant"],
  worship: ["place_of_worship"],
  lodging: ["alpine_hut", "camp_site", "wilderness_hut"],
  playgrounds: ["playground"],
  schools: ["school"],
  colleges: ["college", "university"],
  cemeteries: ["cemetery", "grave_yard"],
};

export const FEATURE_CATALOG: FeatureOption[] = [
  { id: "major-roads", label: "Major roads", group: "geography", defaultOn: true },
  { id: "streets", label: "Residential streets", group: "geography", defaultOn: true },
  { id: "paths", label: "Paths & trails", group: "geography", defaultOn: true },
  { id: "rail", label: "Railways", group: "geography", defaultOn: true },
  { id: "lakes", label: "Lakes & ponds", group: "geography", defaultOn: true },
  { id: "rivers", label: "Rivers & streams", group: "geography", defaultOn: true },
  { id: "forest", label: "Forest", group: "geography", defaultOn: true },
  { id: "parks", label: "Parks & green space", group: "geography", defaultOn: true },
  { id: "farmland", label: "Farmland", group: "geography", defaultOn: true },
  { id: "wetlands", label: "Wetlands & marshes", group: "geography", defaultOn: true },
  { id: "vegetation", label: "Grassland, scrub & heath", group: "geography", defaultOn: true },
  { id: "beaches", label: "Beaches & sand", group: "geography", defaultOn: true },
  { id: "coastline", label: "Coastline", group: "geography", defaultOn: true },
  { id: "rock", label: "Rock & scree", group: "geography", defaultOn: true },
  { id: "cliffs", label: "Cliffs", group: "geography", defaultOn: true },
  { id: "glaciers", label: "Glaciers", group: "geography", defaultOn: true },
  { id: "peaks", label: "Peaks", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "towns", label: "Towns & villages", group: "landmarks", defaultOn: false, nearRouteM: 1_000 },
  { id: "neighbourhoods", label: "Neighbourhoods", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "named-water", label: "Named water", group: "landmarks", defaultOn: false, nearRouteM: 500 },
  { id: "strava-segments", label: "Named trails", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "viewpoints", label: "Viewpoints & attractions", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "historic", label: "Historic places", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "named-parks", label: "Named parks & reserves", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "structures", label: "Bridges, towers, lighthouses", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "food", label: "Cafes, pubs & restaurants", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "worship", label: "Places of worship", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "lodging", label: "Campsites & huts", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "playgrounds", label: "Playgrounds", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "schools", label: "Schools", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "colleges", label: "Colleges & universities", group: "landmarks", defaultOn: false, nearRouteM: 100 },
  { id: "cemeteries", label: "Cemeteries", group: "landmarks", defaultOn: false, nearRouteM: 100 },
];

const KIND_TO_FEATURE = Object.fromEntries(
  Object.entries(LANDMARK_KINDS).flatMap(([id, kinds]) => kinds.map((kind) => [kind, id])),
) as Record<string, string>;

export const DEFAULT_FEATURE_IDS = FEATURE_CATALOG.filter((item) => item.defaultOn).map((item) => item.id);

export function defaultLandmarkNearM(catalog: FeatureOption[] = FEATURE_CATALOG): Record<string, number> {
  return Object.fromEntries(
    catalog
      .filter((item) => item.group === "landmarks")
      .map((item) => [item.id, item.nearRouteM ?? DEFAULT_NEAR_ROUTE_M]),
  );
}

export function clampNearRouteM(value: number): number {
  if (!Number.isFinite(value) || value < 0) return DEFAULT_NEAR_ROUTE_M;
  return Math.round(Math.min(MAX_NEAR_ROUTE_M, value));
}

export function featureIdForKind(kind?: string): string | undefined {
  return kind ? KIND_TO_FEATURE[kind] : undefined;
}

export function nearRouteMForKind(kind?: string, overrides: Record<string, number> = {}): number {
  const id = featureIdForKind(kind);
  if (id) return overrides[id] ?? FEATURE_CATALOG.find((item) => item.id === id)?.nearRouteM ?? DEFAULT_NEAR_ROUTE_M;
  if (overrides.historic != null && kind && !KIND_TO_FEATURE[kind]) return overrides.historic;
  return DEFAULT_NEAR_ROUTE_M;
}

export function encodeFeatureQuery(ids: string[], nearRouteM: Record<string, number>, catalog: FeatureOption[] = FEATURE_CATALOG) {
  return ids
    .map((id) => {
      const item = catalog.find((feature) => feature.id === id);
      if (item?.group !== "landmarks") return id;
      const meters = nearRouteM[id] ?? item.nearRouteM ?? DEFAULT_NEAR_ROUTE_M;
      return `${id}:${clampNearRouteM(meters)}`;
    })
    .join(",");
}

/** Geography is fetched once; its checkboxes only control local rendering. */
export function contextFeatureQuery(ids: string[], nearRouteM: Record<string, number>, catalog: FeatureOption[] = FEATURE_CATALOG) {
  return encodeFeatureQuery(
    catalog.filter((item) => item.group === "geography" || ids.includes(item.id)).map((item) => item.id),
    nearRouteM,
    catalog,
  );
}
