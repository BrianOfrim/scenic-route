import { Map } from "../../maplibre";
import { maskImageToRegion, maskIsActive, projectorForFrame, type GeoMask, type MapFrame } from "./geoMask";
import { cameraForFrame, fittedFrame } from "./mapFrame";
import { canvasSize, drawGpsTrack, drawRouteEndMarkers } from "./renderSchematic";

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

const TILE_SETTLE_TIMEOUT_MS = 45_000;

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
  const fitted = fittedFrame(options.bbox, width, height);
  const camera = cameraForFrame({ width, height, nw: fitted.nw, se: fitted.se });
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
      center: camera.center,
      zoom: camera.zoom,
      maxZoom: Math.max(22, camera.zoom),
      bearing: 0,
      pitch: 0,
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
    map.resize();
    // Low-zoom placeholders stay on screen until every target tile has arrived.
    // Capturing on a timer saves that blur with only the tiles that won the race.
    await waitForSettledTiles(map, TILE_SETTLE_TIMEOUT_MS, signal);
    if (signal?.aborted) throw abortError();
    map.redraw();
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
    routeBreaks?: number[];
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
      overlayRoute(ctx, project, options.latlng, options.routeBreaks ?? [], options.routeMarkers ?? "ends", frame.scale);
      // Keep the route's edges and reference color free of JPEG compression artifacts.
      resolve(canvas.toDataURL("image/png"));
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
  breaks: number[],
  markers: false | "ends" | "loop",
  scale: number,
) {
  if (latlng.length < 2) return;
  const points = latlng.map(([lat, lng]) => project(lng, lat));
  drawGpsTrack(ctx, points, [], breaks, scale, true);
  if (markers) drawRouteEndMarkers(ctx, points[0], points[points.length - 1], markers, scale);
}

function abortError() {
  return new DOMException("Satellite snapshot aborted", "AbortError");
}

function waitForSettledTiles(map: Map, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      map.off("idle", onIdle);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onIdle = () => {
      try {
        if (map.areTilesLoaded()) finish();
      } catch (error) {
        finish(error);
      }
    };
    const onAbort = () => finish(abortError());
    const timer = window.setTimeout(() => {
      finish(new Error("Satellite imagery did not finish loading"));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort);
    map.on("idle", onIdle);
    try {
      if (map.loaded() && map.areTilesLoaded()) finish();
    } catch (error) {
      finish(error);
    }
  });
}
