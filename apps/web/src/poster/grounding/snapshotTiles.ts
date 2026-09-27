import { Map } from "../../maplibre";
import { maskImageToRegion, maskIsActive, projectorForFrame, type GeoMask, type MapFrame } from "./geoMask";
import { cameraForFrame, fittedFrame } from "./mapFrame";
import { canvasSize, drawRouteEndMarkers } from "./renderSchematic";

export type TileSource = "osm" | "topo" | "satellite";

const TILE_URLS: Record<TileSource, string> = {
  osm: "/api/tiles/osm/{z}/{x}/{y}.png",
  topo: "/api/tiles/topo/{z}/{x}/{y}.png",
  satellite: "/api/tiles/satellite/{z}/{x}/{y}.png",
};

export type SatelliteFrame = MapFrame & {
  url: string;
  scale: number;
};

export async function snapshotTiles(
  options: {
    source: TileSource;
    bbox: [[number, number], [number, number]];
    aspectRatio: string;
  },
  signal?: AbortSignal,
): Promise<SatelliteFrame> {
  if (signal?.aborted) throw abortError();
  const { width, height } = canvasSize(options.aspectRatio);
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(container);

  let map: Map | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    map?.remove();
    container.remove();
  };

  try {
    map = new Map({
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
    if (signal?.aborted) throw abortError();
    await waitFor(map, "load", 12_000, signal);
    map.resize();
    const frame = fittedFrame(options.bbox, width, height);
    const camera = cameraForFrame({ width, height, nw: frame.nw, se: frame.se });
    if (camera.zoom > map.getMaxZoom()) map.setMaxZoom(camera.zoom);
    map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      bearing: 0,
      pitch: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await waitFor(map, "idle", 12_000, signal);
    if (signal?.aborted) throw abortError();
    return captureFrame(map, options.source);
  } finally {
    dispose();
  }
}

/** Apply the geography mask, then draw the GPS track on a captured satellite frame. */
export function renderMaskedSatellite(
  frame: SatelliteFrame,
  options: {
    latlng: [number, number][];
    routeMarkers?: false | "ends" | "loop";
    mask?: GeoMask | null;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create a 2D canvas context"));
        return;
      }
      ctx.drawImage(image, 0, 0, frame.width, frame.height);
      const project = projectorForFrame(frame);
      if (options.mask && maskIsActive(options.mask)) {
        maskImageToRegion(ctx, project, options.mask, options.latlng);
      }
      overlayRoute(ctx, project, options.latlng, options.routeMarkers ?? "ends", frame.scale);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => reject(new Error("Could not read the satellite image"));
    image.src = frame.url;
  });
}

function captureFrame(map: Map, source: TileSource): SatelliteFrame {
  const gl = map.getCanvas();
  const canvas = document.createElement("canvas");
  canvas.width = gl.width;
  canvas.height = gl.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  ctx.drawImage(gl, 0, 0);
  const cssW = gl.clientWidth || canvas.width;
  const cssH = gl.clientHeight || canvas.height;
  const scale = cssW ? canvas.width / cssW : 1;
  const nw = map.unproject([0, 0]);
  const se = map.unproject([cssW, cssH]);
  const mime = source === "satellite" ? "image/jpeg" : "image/png";
  return {
    url: canvas.toDataURL(mime, 0.85),
    width: canvas.width,
    height: canvas.height,
    nw: [nw.lng, nw.lat],
    se: [se.lng, se.lat],
    scale,
  };
}

function overlayRoute(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  latlng: [number, number][],
  markers: false | "ends" | "loop",
  scale: number,
) {
  if (latlng.length < 2) return;
  const points = latlng.map(([lat, lng]) => project(lng, lat));
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

function abortError() {
  return new DOMException("Satellite snapshot aborted", "AbortError");
}

function waitFor(map: Map, event: "load" | "idle", timeoutMs = 12_000, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    if (event === "load" && map.loaded()) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off(event, onEvent);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
    map.once(event, onEvent);
  });
}
