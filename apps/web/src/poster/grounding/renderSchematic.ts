import type { Geometry } from "geojson";
import { routeVertexColors } from "../trailColors";
import { projectorForBbox } from "./mapFrame";

export type AspectRatio = "3:4" | "2:3" | "1:1" | "4:3" | "16:9";

export const DEFAULT_ASPECT_RATIO: AspectRatio = "3:4";

type WayFeature = {
  properties?: { class?: string } | null;
  geometry?: Geometry | null;
};

export type RenderSchematicOptions = {
  latlng: [number, number][];
  bbox?: [[number, number], [number, number]];
  ways?: Record<string, { features?: WayFeature[] }>;
  /** Landmarks drawn as numbered discs, most important first. Names live in the prompt key. */
  pois?: Array<{ name: string; lat: number; lng: number }>;
  /** Landmarks drawn as a dot only, so the image model sees the place without a label to garble. */
  unlabeledPois?: Array<{ name: string; lat: number; lng: number }>;
  /** Named trails recolor the GPS track. Names live in the prompt color key. */
  namedWays?: Array<{
    name: string;
    color?: string;
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
    routeSpans?: Array<{ start: number; end: number }>;
  }>;
  /** Named districts drawn as washes. Letters are a private index; names live in the prompt. */
  namedAreas?: Array<{
    name: string;
    letter?: string;
    lat?: number;
    lng?: number;
    geometry:
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };
  }>;
  layers?: {
    urban?: boolean;
    roads?: boolean;
    streets?: boolean;
    paths?: boolean;
    rail?: boolean;
    water?: boolean;
    waterways?: boolean;
    forest?: boolean;
    parks?: boolean;
    farmland?: boolean;
    "wetlands"?: boolean;
    "vegetation"?: boolean;
    "beaches"?: boolean;
    "coastline"?: boolean;
    "rock"?: boolean;
    "cliffs"?: boolean;
    "glaciers"?: boolean;
    cemeteries?: boolean;
    labels?: boolean;
    route?: boolean;
    routeMarkers?: false | "ends" | "loop";
  };
  aspectRatio?: AspectRatio | string;
  silhouette?: boolean;
  /** Lng/lat ring. Background geography outside it is hidden. The route is not clipped. */
  clipPolygon?: [number, number][];
};

export type SchematicLayers = NonNullable<RenderSchematicOptions["layers"]>;

export function schematicLayersFromFeatureIds(
  featureIds: readonly string[],
  routeMarkers: false | "ends" | "loop" = "ends",
): SchematicLayers {
  return {
    urban: featureIds.includes("urban"),
    roads: featureIds.includes("major-roads"),
    streets: featureIds.includes("streets"),
    paths: featureIds.includes("paths"),
    rail: featureIds.includes("rail"),
    water: featureIds.includes("lakes"),
    waterways: featureIds.includes("rivers"),
    forest: featureIds.includes("forest"),
    parks: featureIds.includes("parks"),
    farmland: featureIds.includes("farmland"),
    "wetlands": featureIds.includes("wetlands"),
    "vegetation": featureIds.includes("vegetation"),
    "beaches": featureIds.includes("beaches"),
    "coastline": featureIds.includes("coastline"),
    "rock": featureIds.includes("rock"),
    "cliffs": featureIds.includes("cliffs"),
    "glaciers": featureIds.includes("glaciers"),
    cemeteries: featureIds.includes("cemeteries"),
    labels: true,
    route: true,
    routeMarkers,
  };
}

/** Keep strokes readable as the map zooms in or out of a fitted route. */
export function schematicLineScale(zoom: number) {
  return Math.min(5, Math.max(0.75, 2 ** (zoom - 13)));
}

const SHORT_SIDE = 1024;
const ROUTE_COLOR = "#ff0000";

const ROAD_WIDTH: Record<string, number> = {
  motorway: 2.6,
  trunk: 2.4,
  primary: 2,
  secondary: 1.5,
};

export function drawRouteEndMarkers(
  ctx: CanvasRenderingContext2D,
  start: [number, number],
  end: [number, number],
  mode: "ends" | "loop",
  scale = 1,
) {
  if (mode === "loop") {
    loopDot(ctx, start[0], start[1], scale);
    return;
  }
  dot(ctx, start[0], start[1], "#2f9e44", 8 * scale);
  dot(ctx, end[0], end[1], "#111111", 8 * scale);
}

function drawGpsTrack(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  vertexColors: Array<string | null>,
  scale = 1,
) {
  if (points.length < 2) return;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const runs: Array<{ color: string | null; start: number; end: number }> = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const color = vertexColors[i] ?? vertexColors[i + 1] ?? null;
    const last = runs[runs.length - 1];
    if (last && last.color === color && last.end === i) last.end = i + 1;
    else runs.push({ color, start: i, end: i + 1 });
  }
  ctx.lineWidth = 6 * scale;
  for (const run of runs) {
    ctx.strokeStyle = run.color ?? ROUTE_COLOR;
    strokePoints(ctx, points.slice(run.start, run.end + 1));
  }
}

function loopDot(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  dot(ctx, x, y, "#c9a227", 11 * scale);
  dot(ctx, x, y, "#2f9e44", 6 * scale);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function canvasSize(aspectRatio: string): { width: number; height: number } {
  const [w, h] = parseAspect(aspectRatio);
  if (w <= h) return { width: SHORT_SIDE, height: Math.round((SHORT_SIDE * h) / w) };
  return { width: Math.round((SHORT_SIDE * w) / h), height: SHORT_SIDE };
}

export function renderSchematicDataUrl(options: RenderSchematicOptions): string {
  const canvas = document.createElement("canvas");
  return renderSchematic(canvas, options);
}

export function renderSchematic(canvas: HTMLCanvasElement, options: RenderSchematicOptions): string {
  const aspect = options.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const { width, height } = canvasSize(aspect);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  if (!options.bbox) throw new Error("Schematic bbox is required");
  const project = projector(options.bbox, width, height);
  drawSchematicScene(ctx, options, project, { width, height });
  return canvas.toDataURL("image/png");
}

export function drawSchematicScene(
  ctx: CanvasRenderingContext2D,
  options: RenderSchematicOptions,
  project: (lng: number, lat: number) => [number, number],
  view: { width: number; height: number; lineScale?: number; northArrow?: boolean },
) {
  const scale = view.lineScale ?? 1;
  const layers = options.layers ?? {};
  const ways = options.ways ?? {};

  ctx.fillStyle = options.silhouette ? "#f4efe4" : "#f7f4ec";
  ctx.fillRect(0, 0, view.width, view.height);

  if (!options.silhouette) {
    const clip = options.clipPolygon;
    const canClip = Boolean(clip && clip.length >= 3);
    if (canClip && clip) {
      ctx.save();
      ctx.beginPath();
      clip.forEach(([lng, lat], index) => {
        const [x, y] = project(lng, lat);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.clip();
    }
    if (layers.urban !== false) fillBucket(ctx, ways.urban, project, "rgba(170, 162, 152, 0.25)");
    if (layers["vegetation"] !== false) fillBucket(ctx, ways["vegetation"], project, "rgba(199, 211, 151, 0.5)");
    if (layers["rock"] !== false) fillBucket(ctx, ways["rock"], project, "rgba(166, 160, 151, 0.5)");
    if (layers["beaches"] !== false) fillBucket(ctx, ways["beaches"], project, "rgba(235, 215, 159, 0.65)");
    if (layers["wetlands"] !== false) fillBucket(ctx, ways["wetlands"], project, "rgba(135, 183, 172, 0.55)");
    if (layers["glaciers"] !== false) fillBucket(ctx, ways["glaciers"], project, "rgba(206, 229, 239, 0.85)");
    if (layers.farmland !== false) fillBucket(ctx, ways.farmland, project, "rgba(214, 196, 140, 0.45)");
    if (layers.cemeteries !== false) fillBucket(ctx, ways.cemeteries, project, "rgba(186, 178, 162, 0.55)");
    drawNamedAreaFills(ctx, options.namedAreas ?? [], project);
    if (layers.parks !== false) fillBucket(ctx, ways.parks, project, "rgba(164, 196, 148, 0.5)");
    if (layers.forest !== false) fillBucket(ctx, ways.forest, project, "rgba(176, 201, 156, 0.55)");
    if (layers.water !== false || layers.coastline !== false) {
      fillBucket(ctx, ways.water, project, "rgba(154, 196, 214, 0.7)");
    }
    if ((layers.waterways ?? layers.water) !== false) {
      ctx.strokeStyle = "rgba(90, 150, 180, 0.85)";
      ctx.lineWidth = 1.4 * scale;
      strokeBucket(ctx, ways.waterways, project);
    }
    if (layers.coastline !== false) {
      ctx.strokeStyle = "#5a96b4";
      ctx.lineWidth = 1.6 * scale;
      strokeBucket(ctx, ways.coastline, project);
    }
    if (layers.cliffs !== false) {
      ctx.strokeStyle = "#776b60";
      ctx.lineWidth = 1.8 * scale;
      strokeBucket(ctx, ways.cliffs, project);
    }
    drawNamedAreaOutlines(ctx, options.namedAreas ?? [], project, scale);
    if (layers.roads !== false) strokeRoads(ctx, ways.roads, project, "#9a958c", scale);
    if (layers.streets !== false) strokeRoads(ctx, ways.streets, project, "#b4afa6", scale);
    if (layers.paths !== false) {
      ctx.setLineDash([4 * scale, 3 * scale]);
      ctx.strokeStyle = "#7a6f5f";
      ctx.lineWidth = 1 * scale;
      strokeBucket(ctx, ways.paths, project);
      ctx.setLineDash([]);
    }
    if (layers.rail !== false) {
      ctx.setLineDash([3 * scale, 3 * scale]);
      ctx.strokeStyle = "#6b6560";
      ctx.lineWidth = 1.1 * scale;
      strokeBucket(ctx, ways.rail, project);
      ctx.setLineDash([]);
    }
    if (canClip) ctx.restore();
  }

  const trails = (options.namedWays ?? []).flatMap((trail) =>
    trail.color ? [{ color: trail.color, geometry: trail.geometry, routeSpans: trail.routeSpans }] : [],
  );
  const sampled = simplifyColored(
    options.latlng,
    options.silhouette || !trails.length ? null : routeVertexColors(options.latlng, trails),
    2000,
  );
  const route = sampled.latlng.map(([lat, lng]) => project(lng, lat));
  const markers = options.silhouette ? false : (layers.routeMarkers ?? "ends");
  if ((layers.route !== false || options.silhouette) && route.length >= 2) {
    const vertexColors = sampled.colors ?? route.map(() => null);
    drawGpsTrack(ctx, route, vertexColors, scale);
    if (markers) drawRouteEndMarkers(ctx, route[0], route[route.length - 1], markers, scale);
  }

  if (!options.silhouette && layers.labels !== false) {
    for (const poi of options.unlabeledPois ?? []) {
      const [x, y] = project(poi.lng, poi.lat);
      poiDot(ctx, x, y, 3 * scale);
    }
    if (view.northArrow !== false) drawNorthArrow(ctx, view.width - 40, 40, scale);
    drawAreaLetters(ctx, options.namedAreas ?? [], project, scale);
    drawNumberedPins(ctx, options.pois ?? [], project, scale);
  }
}

function poiDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#1d1a16";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Numbered discs sit on the geographic point. Names are not drawn here so the
 * image model cannot treat offset label text as the landmark's location.
 */
type SchematicArea = {
  letter?: string;
  lat?: number;
  lng?: number;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};

/** Ochre sits under park/forest/water so land cover stays readable. */
function drawNamedAreaFills(
  ctx: CanvasRenderingContext2D,
  areas: SchematicArea[],
  project: (lng: number, lat: number) => [number, number],
) {
  if (!areas.length) return;
  ctx.fillStyle = "rgba(196, 148, 88, 0.22)";
  for (const area of areas) fillGeometry(ctx, area.geometry, project);
}

function drawNamedAreaOutlines(
  ctx: CanvasRenderingContext2D,
  areas: SchematicArea[],
  project: (lng: number, lat: number) => [number, number],
  scale = 1,
) {
  if (!areas.length) return;
  ctx.setLineDash([5 * scale, 3 * scale]);
  ctx.strokeStyle = "rgba(150, 96, 48, 0.75)";
  ctx.lineWidth = 1.4 * scale;
  ctx.lineJoin = "round";
  for (const area of areas) strokeAreaGeometry(ctx, area.geometry, project);
  ctx.setLineDash([]);
}

/** Letter in the wash — no disc. Names live in the prompt. */
function drawAreaLetters(
  ctx: CanvasRenderingContext2D,
  areas: SchematicArea[],
  project: (lng: number, lat: number) => [number, number],
  scale = 1,
) {
  if (!areas.length) return;
  ctx.font = `700 ${Math.round(16 * scale)}px IBM Plex Sans, Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const area of areas) {
    if (!area.letter) continue;
    const [x, y] = project(...areaLetterPoint(area));
    ctx.lineWidth = 3.2 * scale;
    ctx.strokeStyle = "rgba(255, 248, 236, 0.92)";
    ctx.strokeText(area.letter, x, y);
    ctx.fillStyle = "#6b3f1a";
    ctx.fillText(area.letter, x, y);
  }
}

function areaLetterPoint(area: SchematicArea): [number, number] {
  const ring =
    area.geometry.type === "Polygon" ? area.geometry.coordinates[0] : area.geometry.coordinates[0]?.[0];
  if (ring?.length) {
    const pts =
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring;
    if (pts.length) {
      let lng = 0;
      let lat = 0;
      for (const [x, y] of pts) {
        lng += x;
        lat += y;
      }
      return [lng / pts.length, lat / pts.length];
    }
  }
  if (area.lng != null && area.lat != null) return [area.lng, area.lat];
  return [0, 0];
}

function strokeAreaGeometry(
  ctx: CanvasRenderingContext2D,
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] },
  project: (lng: number, lat: number) => [number, number],
) {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      strokePoints(ctx, ring.map(([lng, lat]) => project(lng, lat)));
    }
    return;
  }
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      strokePoints(ctx, ring.map(([lng, lat]) => project(lng, lat)));
    }
  }
}

function drawNumberedPins(
  ctx: CanvasRenderingContext2D,
  pois: Array<{ name: string; lat: number; lng: number }>,
  project: (lng: number, lat: number) => [number, number],
  scale = 1,
) {
  if (!pois.length) return;
  ctx.font = `700 ${Math.round(14 * scale)}px IBM Plex Sans, Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  pois.forEach((poi, index) => {
    const [x, y] = project(poi.lng, poi.lat);
    const label = String(index + 1);
    const r = (label.length > 1 ? 12 : 10) * scale;
    ctx.fillStyle = "#1d1a16";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8 * scale;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y + 0.5 * scale);
  });
}

function fillBucket(
  ctx: CanvasRenderingContext2D,
  bucket: { features?: WayFeature[] } | undefined,
  project: (lng: number, lat: number) => [number, number],
  color: string,
) {
  ctx.fillStyle = color;
  for (const feature of bucket?.features ?? []) fillGeometry(ctx, feature.geometry, project);
}

function strokeBucket(
  ctx: CanvasRenderingContext2D,
  bucket: { features?: WayFeature[] } | undefined,
  project: (lng: number, lat: number) => [number, number],
) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const feature of bucket?.features ?? []) strokeGeometry(ctx, feature.geometry, project);
}

function strokeRoads(
  ctx: CanvasRenderingContext2D,
  bucket: { features?: WayFeature[] } | undefined,
  project: (lng: number, lat: number) => [number, number],
  color: string,
  scale = 1,
) {
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const feature of bucket?.features ?? []) {
    ctx.lineWidth = (ROAD_WIDTH[feature.properties?.class ?? ""] ?? 0.9) * scale;
    strokeGeometry(ctx, feature.geometry, project);
  }
}

function parseAspect(aspectRatio: string): [number, number] {
  const parts = aspectRatio.split(":").map(Number);
  return [parts[0] > 0 ? parts[0] : 2, parts[1] > 0 ? parts[1] : 3];
}

function projector(bbox: [[number, number], [number, number]], width: number, height: number) {
  return projectorForBbox(bbox, width, height);
}

function fillGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry | null | undefined,
  project: (lng: number, lat: number) => [number, number],
) {
  if (!geometry) return;
  if (geometry.type === "Polygon") fillRings(ctx, geometry.coordinates, project);
  else if (geometry.type === "MultiPolygon") {
    ctx.beginPath();
    let traced = false;
    for (const polygon of geometry.coordinates) {
      if (!polygon.length) continue;
      traceRings(ctx, polygon, project);
      traced = true;
    }
    if (traced) ctx.fill();
  }
}

function strokeGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry | null | undefined,
  project: (lng: number, lat: number) => [number, number],
) {
  if (!geometry) return;
  if (geometry.type === "LineString") {
    strokePoints(ctx, geometry.coordinates.map(([lng, lat]) => project(lng, lat)));
  } else if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      strokePoints(ctx, line.map(([lng, lat]) => project(lng, lat)));
    }
  }
}

function fillRings(
  ctx: CanvasRenderingContext2D,
  rings: GeoJSON.Position[][],
  project: (lng: number, lat: number) => [number, number],
) {
  if (!rings.length) return;
  ctx.beginPath();
  traceRings(ctx, rings, project);
  ctx.fill();
}

function traceRings(
  ctx: CanvasRenderingContext2D,
  rings: GeoJSON.Position[][],
  project: (lng: number, lat: number) => [number, number],
) {
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function strokePoints(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(x, y - 16 * scale);
  ctx.lineTo(x + 6 * scale, y + 8 * scale);
  ctx.lineTo(x, y + 3 * scale);
  ctx.lineTo(x - 6 * scale, y + 8 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${Math.round(13 * scale)}px IBM Plex Sans, Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("N", x, y + 11 * scale);
  ctx.textAlign = "start";
}

function simplifyColored(
  latlng: [number, number][],
  colors: Array<string | null> | null,
  maxPoints: number,
): { latlng: [number, number][]; colors: Array<string | null> | null } {
  if (latlng.length <= maxPoints) return { latlng, colors };
  const step = (latlng.length - 1) / (maxPoints - 1);
  const nextLat: [number, number][] = [];
  const nextColors: Array<string | null> | null = colors ? [] : null;
  for (let index = 0; index < maxPoints; index += 1) {
    const i = Math.round(index * step);
    nextLat.push(latlng[i]);
    if (nextColors && colors) nextColors.push(colors[i] ?? null);
  }
  return { latlng: nextLat, colors: nextColors };
}
