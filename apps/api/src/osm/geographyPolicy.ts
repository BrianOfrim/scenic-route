import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { mercX, mercY, type BBox } from "../geo";
import { waterClass } from "./waterClasses";
import type { OmittedOverpassElement } from "./overpass";

export const GEOGRAPHY_VERSION = 12;
export type GeographyMode = "auto" | "manual";
export type GeographyDetailScope = "none" | "route" | "all";
export type GeographyProfile = "close-up" | "local" | "town" | "district" | "regional" | "wide";
export type GeographyPolicy = ReturnType<typeof geographyPolicy>;
export type GeographyWays = Record<string, FeatureCollection>;
export type GeographyScene = {
  sceneId?: string;
  queryResponseBytes?: number;
  apiResponseBytes?: number;
  omittedElements?: OmittedOverpassElement[];
  bbox: BBox;
  ways: GeographyWays;
  featureIds: string[];
  policyVersion: number;
  profile: GeographyProfile;
  metersPerPixel: number;
  source: "overpass" | "natural-earth";
  sourceVersion: string;
  completeness: "complete" | "partial" | "generalized" | "fallback";
  warnings: string[];
};

export const GEOGRAPHY_BUCKETS: Record<string, string> = {
  "major-roads": "roads", streets: "streets", paths: "paths", rail: "rail",
  lakes: "water", rivers: "waterways", forest: "forest", parks: "parks",
  farmland: "farmland", wetlands: "wetlands", vegetation: "vegetation",
  beaches: "beaches", coastline: "coastline", rock: "rock", cliffs: "cliffs",
  glaciers: "glaciers", urban: "urban", cemeteries: "cemeteries",
};

/** Explain what the policy can include, regardless of which features exist in a frame. */
export function automaticGeographyAllowance(profile: GeographyProfile, source: GeographyScene["source"], detailScope: GeographyDetailScope = "none") {
  if (source === "natural-earth") return {
    categories: ["generalized roads", "urban footprints", "lakes and reservoirs", "river networks", "coastline and ocean"],
    detail: "Smaller features are omitted according to map scale and source detail.",
  };
  if (profile === "close-up") return {
    categories: ["major and local roads", "paths and trails", "railways", "lakes, ponds and reservoirs",
      "rivers, streams and canals", "forests and parks", "farmland and vegetation", "wetlands", "beaches",
      "coastline", "rock and cliffs", "glaciers", "gardens and recreation grounds"],
    detail: "Small areas must be legible across the map.",
  };
  if (profile === "local") return {
    categories: ["major and local roads", "paths and trails", "railways", "lakes, ponds and reservoirs",
      "rivers, streams and canals", "forests and parks", "farmland and vegetation", "wetlands", "beaches",
      "coastline", "rock and cliffs", "glaciers"],
    detail: detailScope === "all" ? "Small features are retained across the map."
      : detailScope === "route" ? "Small areas must be legible, with an exception for features near the route."
        : "Small areas must be legible across the map.",
  };
  if (detailScope === "all") return {
    categories: ["major and local roads", "paths and trails", "railways", "lakes, ponds and reservoirs",
      "rivers, streams and canals", "forests and parks", "farmland and vegetation", "wetlands", "beaches",
      "coastline", "rock and cliffs", "glaciers"],
    detail: "Small features are retained across the map, regardless of distance from the route.",
  };
  if (profile === "town") return {
    categories: ["connecting roads", "cycleways and tracks", "railways", "lakes and reservoirs",
      "rivers and canals", "forests and parks", "coastline", "glaciers"],
    detail: "Minor streets, streams and small areas are omitted uniformly across the map.",
  };
  if (profile === "regional") return {
    categories: ["arterial roads", "railways", "lakes and reservoirs", "rivers and canals",
      "forests", "coastline", "glaciers"],
    detail: "Minor streets, paths, parks and small areas are omitted uniformly across the map.",
  };
  return {
    categories: ["through roads and connecting streets", "railways", "lakes and reservoirs",
      detailScope === "route" ? "large or route-near ponds" : "larger ponds", "rivers and canals",
      ...(detailScope === "route" ? ["route-near streams"] : []), "forests and larger parks",
      "coastline", "glaciers"],
    detail: detailScope === "route" ? "Minor streets are omitted; small areas may remain when they are near the route."
      : "Minor streets, streams and small areas are omitted uniformly across the map.",
  };
}

/** Canonical poster pixels, independent of editor camera, device pixels and print DPI. */
export function geographyProfileForScale(metersPerPixel: number): GeographyProfile {
  return metersPerPixel < 3 ? "close-up" : metersPerPixel < 10 ? "local"
    : metersPerPixel < 25 ? "town" : metersPerPixel < 50 ? "district"
      : metersPerPixel < 100 ? "regional" : "wide";
}

export function geographyPolicy(bbox: BBox, aspect = "3:4") {
  const [a, b] = /^(3:4|2:3|1:1|4:3|16:9)$/.test(aspect) ? aspect.split(":").map(Number) : [3, 4];
  const width = a <= b ? 1024 : Math.round(1024 * a / b);
  const height = a <= b ? Math.round(1024 * b / a) : 1024;
  let x0 = mercX(bbox[0]), x1 = Math.max(x0 + 1e-6, mercX(bbox[2]));
  let y0 = mercY(bbox[3]), y1 = Math.max(y0 + 1e-6, mercY(bbox[1]));
  const dx = x1 - x0, dy = y1 - y0;
  if (dx / dy < width / height) {
    const extra = (dy * width / height - dx) / 2;
    x0 -= extra; x1 += extra;
  } else {
    const extra = (dx * height / width - dy) / 2;
    y0 -= extra; y1 += extra;
  }
  const px = (x1 - x0) * .03, py = (y1 - y0) * .03;
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  const metersPerPixel = (x1 - x0) * 40075016.686 / width * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180);
  const profile = geographyProfileForScale(metersPerPixel);
  return { version: GEOGRAPHY_VERSION, profile, metersPerPixel, width, height, x0, x1, y0, y1,
    minAreaPx: profile === "close-up" ? 8 : profile === "local" ? 12 : profile === "town" ? 16
      : profile === "regional" ? 32 : 24, simplifyPx: .65 };
}

export function geographyProject(policy: GeographyPolicy, point: Position): [number, number] {
  return [(mercX(point[0]) - policy.x0) / (policy.x1 - policy.x0) * policy.width,
    (mercY(point[1]) - policy.y0) / (policy.y1 - policy.y0) * policy.height];
}

/** Retrieve a superset of useful features. Never filter a road by individual way length. */
export function geographySelectors(profile: GeographyProfile): string[] {
  const closeUp = profile === "close-up";
  const local = closeUp || profile === "local";
  const roads = closeUp ? "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"
    : profile === "local" ? "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street"
      : profile === "regional" || profile === "wide" ? "motorway|trunk|primary|secondary|tertiary"
        : "motorway|trunk|primary|secondary|tertiary|unclassified";
  const paths = local ? "cycleway|track|footway|path|bridleway|pedestrian"
    : profile === "town" ? "cycleway|track" : null;
  const landcover = ["natural=water", "landuse=reservoir", "landuse=forest", "natural=wood",
    ...(profile === "regional" || profile === "wide" ? [] : ["leisure=park", "leisure=nature_reserve"]),
    "natural=glacier",
    ...(local ? ["landuse=farmland", "landuse=meadow", "landuse=orchard", "landuse=vineyard",
      "natural=wetland", "natural=grassland", "natural=scrub", "natural=heath",
      "natural=beach", "natural=sand", "natural=shingle", "natural=bare_rock", "natural=scree",
      "natural=blockfield"] : []),
    ...(closeUp ? ["leisure=garden", "landuse=recreation_ground"] : [])];
  return [
    `way[highway~"^(${roads})(_link)?$"]`,
    ...(paths ? [`way[highway~"^(${paths})$"]${local ? "[footway!=sidewalk][footway!=crossing][footway!=traffic_island][footway!=link]" : ""}`] : []),
    `way[waterway~"^(${local ? "river|stream|canal" : "river|canal"})$"]`,
    'way[railway=rail]', 'way[natural=coastline]',
    ...landcover.flatMap(tag => [`way[${tag}]`, `rel[${tag}]`]),
    ...(local ? ['way[natural=cliff]'] : []),
  ];
}

function ringArea(ring: Position[], policy: GeographyPolicy): number {
  const points = ring.map(point => geographyProject(policy, point));
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

function polygonArea(rings: Position[][], policy: GeographyPolicy) {
  return Math.max(0, ringArea(rings[0], policy) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring, policy), 0));
}

function distanceSquared(p: Position, a: Position, b: Position) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
}

/** Iterative Douglas–Peucker: endpoints and shared junction vertices remain fixed. */
function simplifyLine(line: Position[], policy: GeographyPolicy, junctions: Set<string>): Position[] {
  if (line.length < 3) return line;
  const points = line.map(point => geographyProject(policy, point));
  const anchors = line.flatMap((p, i) => i === 0 || i === line.length - 1 || junctions.has(p.join(",")) ? [i] : []);
  const keep = new Set(anchors);
  const stack = anchors.slice(1).map((end, i) => [anchors[i], end]);
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let best = policy.simplifyPx ** 2, index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceSquared(points[i], points[start], points[end]);
      if (d > best) { best = d; index = i; }
    }
    if (index >= 0) { keep.add(index); stack.push([start, index], [index, end]); }
  }
  return line.filter((_, i) => keep.has(i));
}

function lines(geometry: Geometry): Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
}

/** Input is frame-clipped. Preserve polygon topology; generalized providers simplify polygons upstream. */
export function resolveGeographyScene(ways: GeographyWays, policy: GeographyPolicy, route: [number, number][] = [], detailScope: GeographyDetailScope = "none"): GeographyWays {
  const routePixels = (detailScope === "route" ? route : []).filter((_, i) => i % Math.max(1, Math.ceil(route.length / 256)) === 0)
    .map(([lat, lng]) => geographyProject(policy, [lng, lat]));
  const nearRoute = (coordinates: Position[], radius: number) => coordinates.some((p, i) => {
    if (i % Math.max(1, Math.ceil(coordinates.length / 32)) !== 0) return false;
    const xy = geographyProject(policy, p);
    return routePixels.some(r => (r[0] - xy[0]) ** 2 + (r[1] - xy[1]) ** 2 < radius * radius);
  });
  // Density is measured in projected line pixels per 128-pixel cell. Only minor,
  // distant context is removed; main road and river networks stay connected.
  const cell = (p: Position) => {
    const xy = geographyProject(policy, p);
    return `${Math.floor(xy[0] / 128)},${Math.floor(xy[1] / 128)}`;
  };
  const density = new Map<string, number>();
  for (const key of ["streets", "paths"]) for (const feature of ways[key]?.features ?? []) {
    for (const line of lines(feature.geometry)) for (let i = 1; i < line.length; i++) {
      const a = geographyProject(policy, line[i - 1]), b = geographyProject(policy, line[i]);
      const key = cell(line[i]);
      density.set(key, (density.get(key) ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
  }
  const counts = new Map<string, number>();
  for (const bucket of Object.values(ways)) for (const feature of bucket.features) {
    for (const key of new Set(lines(feature.geometry).flat().map(p => p.join(",")))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const junctions = new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
  return Object.fromEntries(Object.entries(ways).map(([key, bucket]) => [key, {
    type: "FeatureCollection", features: bucket.features.flatMap((feature): Feature[] => {
      const g = feature.geometry;
      const tags = feature.properties?.tags ?? {};
      const kind = (key === "water" || key === "waterways" || key === "riverAreas") ? waterClass(feature) : null;
      if (detailScope !== "all" && key === "waterways" && kind === "stream" && !["close-up", "local"].includes(policy.profile)
        && !nearRoute(lines(g).flat(), 32)) return [];
      if (detailScope !== "all" && !["close-up", "local", "town"].includes(policy.profile) && key === "paths") return [];
      if (detailScope !== "all" && !["close-up", "local"].includes(policy.profile)
        && key === "streets" && /^(residential|service|living_street)$/.test(tags.highway ?? "")) return [];
      if (detailScope !== "all" && (key === "streets" || key === "paths") && /^(service|residential|living_street|footway|path)$/.test(tags.highway ?? "")) {
        const vertices = lines(g).flat();
        if (vertices.length && vertices.every(p => (density.get(cell(p)) ?? 0) > 2500) && !nearRoute(vertices, 64)) return [];
      }
      const keepPolygon = (p: Position[][]) => {
        const area = polygonArea(p, policy);
        const minorWater = (key === "water" && (kind === "pond" || kind === "water"))
          || (key === "riverAreas" && kind === "stream");
        const minimum = minorWater && !["close-up", "local"].includes(policy.profile)
          ? Math.max(policy.minAreaPx, 96) : policy.minAreaPx;
        return detailScope === "all" ? area >= 3 : area >= minimum || (area >= 3 && nearRoute(p[0], 16));
      };
      if (g.type === "Polygon") return keepPolygon(g.coordinates) ? [feature] : [];
      if (g.type === "MultiPolygon") {
        const coordinates = g.coordinates.filter(keepPolygon);
        return coordinates.length ? [{ ...feature, geometry: { ...g, coordinates } }] : [];
      }
      if (g.type === "LineString") return [{ ...feature, geometry: { ...g, coordinates: simplifyLine(g.coordinates, policy, junctions) } }];
      if (g.type === "MultiLineString") return [{ ...feature, geometry: { ...g, coordinates: g.coordinates.map(line => simplifyLine(line, policy, junctions)) } }];
      return [];
    }),
  }]));
}

export function visibleGeographyIds(ways: GeographyWays, ids: readonly string[]) {
  return ids.filter(id => id === "rivers"
    ? (ways.waterways?.features.length ?? 0) + (ways.riverAreas?.features.length ?? 0) > 0
    : (ways[GEOGRAPHY_BUCKETS[id]]?.features.length ?? 0) > 0);
}
