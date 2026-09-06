import type { Geometry } from "geojson";

export type AspectRatio = "2:3" | "3:4" | "1:1" | "4:3" | "16:9";

type WayFeature = {
  properties?: { class?: string } | null;
  geometry?: Geometry | null;
};

export type RenderSchematicOptions = {
  latlng: [number, number][];
  bbox: [[number, number], [number, number]];
  ways?: Record<string, { features?: WayFeature[] }>;
  pois?: Array<{ name: string; lat: number; lng: number }>;
  layers?: {
    roads?: boolean;
    streets?: boolean;
    paths?: boolean;
    rail?: boolean;
    water?: boolean;
    forest?: boolean;
    parks?: boolean;
    farmland?: boolean;
    cemeteries?: boolean;
    labels?: boolean;
    route?: boolean;
    routeMarkers?: false | "ends" | "loop";
  };
  aspectRatio?: AspectRatio | string;
  silhouette?: boolean;
};

const SHORT_SIDE = 1024;
const MARGIN = 0.08;
const LEGEND_H = 36;

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
) {
  if (mode === "loop") {
    loopDot(ctx, start[0], start[1]);
    return;
  }
  dot(ctx, start[0], start[1], "#2f9e44", 6);
  dot(ctx, end[0], end[1], "#111111", 6);
}

function loopDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  dot(ctx, x, y, "#c9a227", 9);
  dot(ctx, x, y, "#2f9e44", 5);
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
  const aspect = options.aspectRatio ?? "2:3";
  const { width, height } = canvasSize(aspect);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  const mapH = options.silhouette ? height : height - LEGEND_H;
  const project = projector(options.bbox, width, mapH);

  ctx.fillStyle = options.silhouette ? "#f4efe4" : "#f7f4ec";
  ctx.fillRect(0, 0, width, height);

  const layers = options.layers ?? {};
  const ways = options.ways ?? {};

  if (!options.silhouette) {
    if (layers.farmland !== false) fillBucket(ctx, ways.farmland, project, "rgba(214, 196, 140, 0.45)");
    if (layers.cemeteries !== false) fillBucket(ctx, ways.cemeteries, project, "rgba(186, 178, 162, 0.55)");
    if (layers.parks !== false) fillBucket(ctx, ways.parks, project, "rgba(164, 196, 148, 0.5)");
    if (layers.forest !== false) fillBucket(ctx, ways.forest, project, "rgba(176, 201, 156, 0.55)");
    if (layers.water !== false) {
      fillBucket(ctx, ways.water, project, "rgba(154, 196, 214, 0.7)");
      ctx.strokeStyle = "rgba(90, 150, 180, 0.85)";
      ctx.lineWidth = 1.4;
      strokeBucket(ctx, ways.waterways, project);
    }
    if (layers.roads !== false) strokeRoads(ctx, ways.roads, project, "#9a958c");
    if (layers.streets !== false) strokeRoads(ctx, ways.streets, project, "#b4afa6");
    if (layers.paths !== false) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#7a6f5f";
      ctx.lineWidth = 1;
      strokeBucket(ctx, ways.paths, project);
      ctx.setLineDash([]);
    }
    if (layers.rail !== false) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#6b6560";
      ctx.lineWidth = 1.1;
      strokeBucket(ctx, ways.rail, project);
      ctx.setLineDash([]);
    }
  }

  const route = simplify(options.latlng, 2000).map(([lat, lng]) => project(lng, lat));
  const markers = options.silhouette ? false : (layers.routeMarkers ?? "ends");
  if ((layers.route !== false || options.silhouette) && route.length >= 2) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = options.silhouette ? "#1a1a1a" : "#3f1d1d";
    ctx.lineWidth = options.silhouette ? 10 : 7;
    strokePoints(ctx, route);
    if (!options.silhouette) {
      ctx.strokeStyle = "#c41e1e";
      ctx.lineWidth = 4;
      strokePoints(ctx, route);
    }
    if (markers) drawRouteEndMarkers(ctx, route[0], route[route.length - 1], markers);
  }

  if (!options.silhouette && layers.labels !== false) {
    ctx.font = "11px IBM Plex Sans, sans-serif";
    ctx.textBaseline = "bottom";
    for (const poi of options.pois ?? []) {
      const [x, y] = project(poi.lng, poi.lat);
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(poi.name, x + 4, y - 3);
    }
    drawNorthArrow(ctx, width - 36, 36);
    drawScaleBar(ctx, options.bbox, width, mapH, project);
    drawLegend(ctx, width, height, markers);
  }

  return canvas.toDataURL("image/png");
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
) {
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const feature of bucket?.features ?? []) {
    ctx.lineWidth = ROAD_WIDTH[feature.properties?.class ?? ""] ?? 0.9;
    strokeGeometry(ctx, feature.geometry, project);
  }
}

function parseAspect(aspectRatio: string): [number, number] {
  const parts = aspectRatio.split(":").map(Number);
  return [parts[0] > 0 ? parts[0] : 2, parts[1] > 0 ? parts[1] : 3];
}

function mercX(lng: number) {
  return (lng + 180) / 360;
}

function mercY(lat: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function projector(bbox: [[number, number], [number, number]], width: number, height: number) {
  const minLng = Math.min(bbox[0][0], bbox[1][0]);
  const minLat = Math.min(bbox[0][1], bbox[1][1]);
  const maxLng = Math.max(bbox[0][0], bbox[1][0]);
  const maxLat = Math.max(bbox[0][1], bbox[1][1]);
  let x0 = mercX(minLng);
  let x1 = mercX(maxLng);
  let y0 = mercY(maxLat);
  let y1 = mercY(minLat);
  if (x1 <= x0) x1 = x0 + 1e-6;
  if (y1 <= y0) y1 = y0 + 1e-6;
  const viewW = x1 - x0;
  const viewH = y1 - y0;
  const canvasAspect = width / height;
  const viewAspect = viewW / viewH;
  if (viewAspect < canvasAspect) {
    const extra = viewH * canvasAspect - viewW;
    x0 -= extra / 2;
    x1 += extra / 2;
  } else {
    const extra = viewW / canvasAspect - viewH;
    y0 -= extra / 2;
    y1 += extra / 2;
  }
  const padX = (x1 - x0) * MARGIN;
  const padY = (y1 - y0) * MARGIN;
  x0 -= padX;
  x1 += padX;
  y0 -= padY;
  y1 += padY;
  return (lng: number, lat: number): [number, number] => [
    ((mercX(lng) - x0) / (x1 - x0)) * width,
    ((mercY(lat) - y0) / (y1 - y0)) * height,
  ];
}

function fillGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry | null | undefined,
  project: (lng: number, lat: number) => [number, number],
) {
  if (!geometry) return;
  if (geometry.type === "Polygon") fillRings(ctx, geometry.coordinates, project);
  else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) fillRings(ctx, polygon, project);
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
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill();
}

function strokePoints(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 5, y + 8);
  ctx.lineTo(x, y + 3);
  ctx.lineTo(x - 5, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = "10px IBM Plex Sans, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("N", x, y + 10);
  ctx.textAlign = "start";
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  bbox: [[number, number], [number, number]],
  width: number,
  height: number,
  project: (lng: number, lat: number) => [number, number],
) {
  const midLat = (bbox[0][1] + bbox[1][1]) / 2;
  const left = project(bbox[0][0], midLat);
  const right = project(bbox[1][0], midLat);
  const spanPx = Math.abs(right[0] - left[0]);
  const spanM = Math.abs(bbox[1][0] - bbox[0][0]) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  if (spanPx < 8 || spanM <= 0) return;
  const meters = niceLength((Math.min(120, width * 0.22) / spanPx) * spanM);
  const barW = (meters / spanM) * spanPx;
  const x = 28;
  const y = height - 16;
  ctx.strokeStyle = "#111";
  ctx.fillStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + barW, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + barW, y - 4);
  ctx.lineTo(x + barW, y + 4);
  ctx.stroke();
  ctx.font = "10px IBM Plex Sans, sans-serif";
  ctx.textBaseline = "bottom";
  ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${Math.round(meters)} m`, x, y - 6);
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  markers: false | "ends" | "loop",
) {
  ctx.fillStyle = "#efe8d8";
  ctx.fillRect(0, height - LEGEND_H, width, LEGEND_H);
  ctx.fillStyle = "#2c261c";
  ctx.font = "11px IBM Plex Sans, sans-serif";
  ctx.textBaseline = "middle";
  const markerNote =
    markers === "loop"
      ? "gold/green = start/finish"
      : markers === "ends"
        ? "green/black dots = start/finish"
        : "";
  ctx.fillText(
    ["red = route", "grey = roads", "blue = water", "green = forest", markerNote].filter(Boolean).join("   "),
    16,
    height - LEGEND_H / 2,
  );
}

function niceLength(meters: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(meters, 1)));
  const n = meters / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

function simplify(latlng: [number, number][], maxPoints: number) {
  if (latlng.length <= maxPoints) return latlng;
  const step = (latlng.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => latlng[Math.round(index * step)]);
}
