import {
  outerHardCut,
  queryFrameExpandM,
  queryFrameRing,
  type LngLat,
} from "../../../../api/src/osm/geoExtent";
import type { GeoMask } from "./geoMask";

type QueryCorners = [[number, number], [number, number]];
type Scope = "all" | "corridor" | "ends" | "ring";

/**
 * Satellite keep-region.
 * Always the geometry query frame, so portrait letterboxing cannot show
 * terrain the schematic left blank. A tighter geography scope is intersected with that frame.
 */
export function satelliteReferenceMask(input: {
  /** Padded Overpass box, as stored on poster context: [[minLng, minLat], [maxLng, maxLat]]. */
  exactFrame?: boolean;
  queryBbox: QueryCorners | null | undefined;
  /** Full track the query was built from, [lat, lng]. */
  track: [number, number][] | null | undefined;
  route: [number, number][];
  scope: Scope;
  corridorM?: number | null;
  ring?: LngLat[] | null;
}): GeoMask | null {
  const track = input.track ?? [];
  if (input.route.length < 2 || track.length < 2 || !input.queryBbox) return null;
  const [a, b] = input.queryBbox;
  const frame = queryFrameRing(
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    input.exactFrame ? 0 : queryFrameExpandM(track),
  );
  if (frame.length < 3) return null;
  if (input.scope === "all") return { clip: frame };
  const cut = outerHardCut(input.route, input.scope, {
    corridorM: input.corridorM,
    ring: input.ring,
  });
  if (!cut) return { clip: frame, whole: true };
  if (cut.kind === "ring") return { rings: [cut.ring], clip: frame, whole: true };
  return { bandM: cut.bandM, clip: frame, whole: true };
}
