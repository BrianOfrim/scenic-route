import type { GroundingLayer } from "./contactSheet";

/** Keep route geometry at full resolution rather than squeezing it into a contact sheet. */
export function selectReferenceLayers(
  schematic: GroundingLayer,
  route: GroundingLayer | null,
  satellite: GroundingLayer | null,
  maxRefs: number,
): GroundingLayer[] {
  const limit = Math.max(1, Math.floor(maxRefs) || 1);
  if (limit === 1) return [schematic];
  return [route, schematic, satellite].filter((item): item is GroundingLayer => item !== null).slice(0, limit);
}
