import type { Feature } from "geojson";

export type WaterClass = "river" | "stream" | "canal" | "lake" | "pond" | "reservoir" | "ocean" | "water";

/** OSM tags describe kind, while Natural Earth supplies only generalized layers. */
export function waterClass(feature: Feature): WaterClass {
  const properties = feature.properties ?? {};
  const tags = (properties.tags ?? {}) as Record<string, string>;
  const id = String(properties.id ?? "");
  if (id.startsWith("ne/ocean/")) return "ocean";
  if (id.startsWith("ne/rivers/")) return "river";
  if (id.startsWith("ne/lakes/")) return "lake";
  if (tags.waterway === "stream" || tags.waterway === "river" || tags.waterway === "canal") return tags.waterway;
  if (tags.water === "river" || tags.water === "stream" || tags.water === "canal") return tags.water;
  if (tags.water === "pond" || tags.water === "lake" || tags.water === "reservoir") return tags.water;
  if (tags.landuse === "reservoir") return "reservoir";
  return "water";
}

export function isAreaFeature(feature: Feature): boolean {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}
