import { Map } from "../../maplibre";
import { canvasSize, drawRouteEndMarkers } from "./renderSchematic";

export type TileSource = "osm" | "topo" | "satellite";

const TILE_URLS: Record<TileSource, string> = {
  osm: "/api/tiles/osm/{z}/{x}/{y}.png",
  topo: "/api/tiles/topo/{z}/{x}/{y}.png",
  satellite: "/api/tiles/satellite/{z}/{x}/{y}.png",
};

export async function snapshotTiles(options: {
  source: TileSource;
  bbox: [[number, number], [number, number]];
  latlng: [number, number][];
  aspectRatio: string;
  routeMarkers?: false | "ends" | "loop";
}): Promise<string> {
  const { width, height } = canvasSize(options.aspectRatio);
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(container);

  const map = new Map({
    container,
    style: {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [TILE_URLS[options.source]],
          tileSize: 256,
          attribution: options.source,
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#111318" } },
        { id: "basemap", type: "raster", source: "basemap" },
      ],
    },
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    fadeDuration: 0,
  });

  try {
    await waitFor(map, "load");
    const bounds: [[number, number], [number, number]] = [
      [Math.min(options.bbox[0][0], options.bbox[1][0]), Math.min(options.bbox[0][1], options.bbox[1][1])],
      [Math.max(options.bbox[0][0], options.bbox[1][0]), Math.max(options.bbox[0][1], options.bbox[1][1])],
    ];
    map.resize();
    map.fitBounds(bounds, { padding: 24, animate: false });
    await waitFor(map, "idle");
    return compositeRoute(map, options.latlng, options.routeMarkers ?? "ends", options.source);
  } finally {
    map.remove();
    container.remove();
  }
}

function compositeRoute(
  map: Map,
  latlng: [number, number][],
  markers: false | "ends" | "loop",
  source: TileSource,
): string {
  const gl = map.getCanvas();
  const canvas = document.createElement("canvas");
  canvas.width = gl.width;
  canvas.height = gl.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  ctx.drawImage(gl, 0, 0);
  const cssW = gl.clientWidth || canvas.width;
  const scale = cssW ? canvas.width / cssW : 1;
  overlayRoute(ctx, map, latlng, markers, scale);
  const mime = source === "satellite" ? "image/jpeg" : "image/png";
  return canvas.toDataURL(mime, 0.85);
}

function overlayRoute(
  ctx: CanvasRenderingContext2D,
  map: Map,
  latlng: [number, number][],
  markers: false | "ends" | "loop",
  scale: number,
) {
  if (latlng.length < 2) return;
  const points = latlng.map(([lat, lng]) => {
    const p = map.project([lng, lat]);
    return [p.x * scale, p.y * scale] as [number, number];
  });
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 6 * scale;
  stroke(ctx, points);
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = 3.5 * scale;
  stroke(ctx, points);
  if (markers) drawRouteEndMarkers(ctx, points[0], points[points.length - 1], markers, scale);
}

function stroke(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

function waitFor(map: Map, event: "load" | "idle", timeoutMs = 12_000) {
  return new Promise<void>((resolve) => {
    if (event === "load" && map.loaded()) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    map.once(event, () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
