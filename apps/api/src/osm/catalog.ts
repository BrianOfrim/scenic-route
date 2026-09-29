export type FeatureGroup = "geography" | "landmarks";

export type FeatureDef = {
  id: string;
  label: string;
  group: FeatureGroup;
  bucket: string;
  selectors: string[];
  defaultOn?: boolean;
  weight?: number;
  /** Auto-add corridor in metres for landmark categories. */
  nearRouteM?: number;
  kinds?: string[];
};

export const DEFAULT_NEAR_ROUTE_M = 100;
export const MAX_NEAR_ROUTE_M = 20_000;

/** Sidewalks, crossings, islands, and the short links between them. Absent footway tags still match. */
const NOT_SIDEWALK =
  "[footway!=sidewalk][footway!=crossing][footway!=traffic_island][footway!=link]";

export const FEATURE_CATALOG: FeatureDef[] = [
  { id: "urban", label: "Urban footprints", group: "geography", bucket: "urban", selectors: [], defaultOn: true },
  {
    id: "major-roads",
    label: "Major roads",
    group: "geography",
    bucket: "roads",
    selectors: ['way[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link)$"]'],
    defaultOn: true,
  },
  {
    id: "streets",
    label: "Residential streets",
    group: "geography",
    bucket: "streets",
    selectors: ['way[highway~"^(tertiary|tertiary_link|unclassified|residential|living_street|service)$"]'],
    defaultOn: true,
  },
  {
    id: "paths",
    label: "Paths & trails",
    group: "geography",
    bucket: "paths",
    selectors: [
      `way[highway~"^(cycleway|track|footway|path|bridleway|pedestrian)$"]${NOT_SIDEWALK}`,
    ],
    defaultOn: true,
  },
  {
    id: "rail",
    label: "Railways",
    group: "geography",
    bucket: "rail",
    selectors: ["way[railway=rail]"],
    defaultOn: true,
  },
  {
    id: "lakes",
    label: "Lakes & ponds",
    group: "geography",
    bucket: "water",
    selectors: ["nwr[natural=water]", "nwr[water]"],
    defaultOn: true,
  },
  {
    id: "rivers",
    label: "Rivers & streams",
    group: "geography",
    bucket: "waterways",
    selectors: ['way[waterway~"^(river|stream|canal)$"]'],
    defaultOn: true,
  },
  {
    id: "forest",
    label: "Forest",
    group: "geography",
    bucket: "forest",
    selectors: ["nwr[landuse=forest]", "nwr[natural=wood]"],
    defaultOn: true,
  },
  {
    id: "parks",
    label: "Parks & green space",
    group: "geography",
    bucket: "parks",
    selectors: ['nwr[leisure~"^(park|nature_reserve|garden)$"]', "nwr[landuse=recreation_ground]"],
    defaultOn: true,
  },
  {
    id: "farmland",
    label: "Farmland",
    group: "geography",
    bucket: "farmland",
    selectors: ['nwr[landuse~"^(farmland|meadow|orchard|vineyard)$"]'],
    defaultOn: true,
  },
  {
    id: "wetlands",
    label: "Wetlands & marshes",
    group: "geography",
    bucket: "wetlands",
    selectors: ['nwr[natural=wetland]'],
    defaultOn: true,
  },
  {
    id: "vegetation",
    label: "Grassland, scrub & heath",
    group: "geography",
    bucket: "vegetation",
    selectors: ['nwr[natural~"^(grassland|scrub|heath)$"]'],
    defaultOn: true,
  },
  {
    id: "beaches",
    label: "Beaches & sand",
    group: "geography",
    bucket: "beaches",
    selectors: ['nwr[natural~"^(beach|sand|shingle)$"]'],
    defaultOn: true,
  },
  {
    id: "coastline",
    label: "Coastline",
    group: "geography",
    bucket: "coastline",
    selectors: ['way[natural=coastline]'],
    defaultOn: true,
  },
  {
    id: "rock",
    label: "Rock & scree",
    group: "geography",
    bucket: "rock",
    selectors: ['nwr[natural~"^(bare_rock|scree|blockfield)$"]'],
    defaultOn: true,
  },
  {
    id: "cliffs",
    label: "Cliffs",
    group: "geography",
    bucket: "cliffs",
    selectors: ['way[natural=cliff]'],
    defaultOn: true,
  },
  {
    id: "glaciers",
    label: "Glaciers",
    group: "geography",
    bucket: "glaciers",
    selectors: ['nwr[natural=glacier]'],
    defaultOn: true,
  },
  {
    id: "peaks",
    label: "Peaks",
    group: "landmarks",
    bucket: "poi",
    selectors: ["nwr[natural=peak][name]"],
    defaultOn: false,
    weight: 100,
    nearRouteM: 100,
    kinds: ["peak"],
  },
  {
    id: "towns",
    label: "Towns & villages",
    group: "landmarks",
    bucket: "poi",
    selectors: ['nwr[place~"^(city|town|village|hamlet|suburb|locality)$"][name]'],
    defaultOn: false,
    weight: 88,
    nearRouteM: 1_000,
    kinds: ["city", "town", "village", "hamlet", "suburb", "locality"],
  },
  {
    id: "neighbourhoods",
    label: "Neighbourhoods",
    group: "landmarks",
    bucket: "named-areas",
    selectors: ['nwr[place~"^(neighbourhood|quarter)$"][name]'],
    defaultOn: false,
    weight: 46,
    nearRouteM: 100,
    kinds: ["neighbourhood", "quarter"],
  },
  {
    id: "named-water",
    label: "Named water",
    group: "landmarks",
    bucket: "poi",
    selectors: [
      'nwr[natural~"^(water|bay|beach)$"][name]',
      'nwr[waterway~"^(river|waterfall)$"][name]',
    ],
    defaultOn: false,
    weight: 85,
    nearRouteM: 500,
    kinds: ["water", "bay", "beach", "river", "waterfall"],
  },
  {
    id: "named-trails",
    label: "Named trails",
    group: "landmarks",
    bucket: "named-ways",
    selectors: [
      `way[highway~"^(path|track|footway|cycleway|bridleway)$"][name]${NOT_SIDEWALK}`,
      'relation[type=route][route~"^(hiking|foot|bicycle|mtb)$"][name]',
    ],
    defaultOn: false,
    weight: 80,
    nearRouteM: 100,
    kinds: ["trail"],
  },
  {
    id: "viewpoints",
    label: "Viewpoints & attractions",
    group: "landmarks",
    bucket: "poi",
    selectors: ['nwr[tourism~"^(viewpoint|attraction|castle)$"][name]'],
    defaultOn: false,
    weight: 75,
    nearRouteM: 100,
    kinds: ["viewpoint", "attraction", "castle"],
  },
  {
    id: "historic",
    label: "Historic places",
    group: "landmarks",
    bucket: "poi",
    selectors: ["nwr[historic][name]"],
    defaultOn: false,
    weight: 76,
    nearRouteM: 100,
    kinds: [
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
  },
  {
    id: "named-parks",
    label: "Named parks & reserves",
    group: "landmarks",
    bucket: "named-areas",
    selectors: ['nwr[leisure~"^(park|nature_reserve)$"][name]'],
    defaultOn: false,
    weight: 62,
    nearRouteM: 100,
    kinds: ["park", "nature_reserve"],
  },
  {
    id: "structures",
    label: "Bridges, towers, lighthouses",
    group: "landmarks",
    bucket: "poi",
    selectors: ['nwr[man_made~"^(lighthouse|tower|bridge|windmill)$"][name]'],
    defaultOn: false,
    weight: 52,
    nearRouteM: 100,
    kinds: ["lighthouse", "tower", "bridge", "windmill"],
  },
  {
    id: "food",
    label: "Cafes, pubs & restaurants",
    group: "landmarks",
    bucket: "poi",
    selectors: ['nwr[amenity~"^(cafe|pub|restaurant)$"][name]'],
    defaultOn: false,
    weight: 32,
    nearRouteM: 100,
    kinds: ["cafe", "pub", "restaurant"],
  },
  {
    id: "worship",
    label: "Places of worship",
    group: "landmarks",
    bucket: "poi",
    selectors: ["nwr[amenity=place_of_worship][name]"],
    defaultOn: false,
    weight: 30,
    nearRouteM: 100,
    kinds: ["place_of_worship"],
  },
  {
    id: "lodging",
    label: "Campsites & huts",
    group: "landmarks",
    bucket: "poi",
    selectors: ['nwr[tourism~"^(alpine_hut|camp_site|wilderness_hut)$"][name]'],
    defaultOn: false,
    weight: 56,
    nearRouteM: 100,
    kinds: ["alpine_hut", "camp_site", "wilderness_hut"],
  },
  {
    id: "playgrounds",
    label: "Playgrounds",
    group: "landmarks",
    bucket: "poi",
    selectors: ["nwr[leisure=playground][name]"],
    defaultOn: false,
    weight: 28,
    nearRouteM: 100,
    kinds: ["playground"],
  },
  {
    id: "schools",
    label: "Schools",
    group: "landmarks",
    bucket: "poi",
    selectors: ["nwr[amenity=school][name]"],
    defaultOn: false,
    weight: 50,
    nearRouteM: 100,
    kinds: ["school"],
  },
  {
    id: "colleges",
    label: "Colleges & universities",
    group: "landmarks",
    bucket: "named-areas",
    selectors: ['nwr[amenity~"^(college|university)$"][name]'],
    defaultOn: false,
    weight: 68,
    nearRouteM: 100,
    kinds: ["college", "university"],
  },
  {
    id: "cemeteries",
    label: "Cemeteries",
    group: "landmarks",
    bucket: "cemeteries",
    selectors: ["nwr[landuse=cemetery]", "nwr[amenity=grave_yard]"],
    defaultOn: false,
    weight: 54,
    nearRouteM: 100,
    kinds: ["cemetery", "grave_yard"],
  },
];

export const KIND_WEIGHTS: Record<string, number> = {
  peak: 100,
  glacier: 95,
  city: 90,
  town: 88,
  water: 85,
  bay: 84,
  beach: 82,
  river: 82,
  waterfall: 80,
  trail: 80,
  castle: 78,
  historic: 76,
  viewpoint: 75,
  attraction: 74,
  village: 70,
  hamlet: 65,
  cliff: 65,
  park: 62,
  nature_reserve: 62,
  wood: 58,
  alpine_hut: 56,
  cemetery: 54,
  grave_yard: 54,
  camp_site: 54,
  lighthouse: 55,
  tower: 52,
  windmill: 52,
  bridge: 50,
  suburb: 48,
  quarter: 47,
  neighbourhood: 46,
  university: 68,
  college: 64,
  locality: 45,
  school: 50,
  cafe: 32,
  pub: 32,
  restaurant: 32,
  place_of_worship: 30,
  playground: 28,
};

export const DEFAULT_FEATURE_IDS = FEATURE_CATALOG.filter((item) => item.defaultOn).map(
  (item) => item.id,
);

export function catalogPublic() {
  return FEATURE_CATALOG.map((item) => ({
    id: item.id,
    label: item.label,
    group: item.group,
    defaultOn: Boolean(item.defaultOn),
    ...(item.nearRouteM != null ? { nearRouteM: item.nearRouteM } : {}),
  }));
}

export function clampNearRouteM(value: number): number {
  if (!Number.isFinite(value) || value < 0) return DEFAULT_NEAR_ROUTE_M;
  return Math.round(Math.min(MAX_NEAR_ROUTE_M, value));
}

export function parseFeatureSelection(raw?: string): {
  ids?: string[];
  nearRouteM: Record<string, number>;
} {
  if (!raw?.trim()) return { nearRouteM: {} };
  const ids: string[] = [];
  const nearRouteM: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      ids.push(trimmed);
      continue;
    }
    const id = trimmed.slice(0, colon).trim();
    if (!id) continue;
    ids.push(id);
    const meters = Number(trimmed.slice(colon + 1));
    if (Number.isFinite(meters) && meters >= 0) nearRouteM[id] = clampNearRouteM(meters);
  }
  return { ids, nearRouteM };
}

export function resolveFeatures(ids?: string[], nearRouteM?: Record<string, number>): FeatureDef[] {
  const wanted = ids?.length ? new Set(ids) : new Set(DEFAULT_FEATURE_IDS);
  return FEATURE_CATALOG.filter((item) => wanted.has(item.id)).map((item) => {
    const override = nearRouteM?.[item.id];
    if (override == null || item.group !== "landmarks") return item;
    return { ...item, nearRouteM: clampNearRouteM(override) };
  });
}

export function nearRouteMForKind(kind?: string, selected: FeatureDef[] = FEATURE_CATALOG): number {
  const pool = selected.length ? selected : FEATURE_CATALOG;
  if (kind) {
    const match = pool.find((item) => item.kinds?.includes(kind));
    if (match?.nearRouteM != null) return match.nearRouteM;
    const historic = pool.find((item) => item.id === "historic");
    if (historic?.nearRouteM != null && !FEATURE_CATALOG.some((item) => item.id !== "historic" && item.kinds?.includes(kind))) {
      return historic.nearRouteM;
    }
  }
  return DEFAULT_NEAR_ROUTE_M;
}
