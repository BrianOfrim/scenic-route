import { Map } from "../../maplibre";
import { canvasSize } from "./renderSchematic";

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
    overlayRoute(map.getCanvas(), map, options.latlng);
    return map.getCanvas().toDataURL("image/png");
  } finally {
    map.remove();
    container.remove();
  }
}

function overlayRoute(
  canvas: HTMLCanvasElement,
  map: Map,
  latlng: [number, number][],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || latlng.length < 2) return;
  const points = latlng.map(([lat, lng]) => {
    const p = map.project([lng, lat]);
    return [p.x, p.y] as [number, number];
  });
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 6;
  stroke(ctx, points);
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = 3.5;
  stroke(ctx, points);
}

function stroke(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
}

function waitFor(map: Map, event: "load" | "idle") {
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    if (event === "load" && map.loaded()) {
      resolve();
      return;
    }
    map.once(event, done);
  });
}
