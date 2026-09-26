import { lngLatFromMercator, mercatorX, mercatorY, projectorForFrame, type MapFrame } from "./geoMask";

/** Fraction of the fitted window added on every side so the route is not flush with the edge. */
const MARGIN = 0.03;

/** MapLibre measures the world as this many pixels across at zoom 0. */
const MAP_TILE_SIZE = 512;

export type BboxCorners = [[number, number], [number, number]];

/**
 * Web Mercator window shared by the schematic and the satellite photograph.
 * The bbox is fit to the canvas aspect, then padded by the shared margin.
 * Northwest and southeast are [lng, lat].
 */
export function fittedFrame(bbox: BboxCorners, width: number, height: number): Pick<MapFrame, "nw" | "se"> {
  const minLng = Math.min(bbox[0][0], bbox[1][0]);
  const minLat = Math.min(bbox[0][1], bbox[1][1]);
  const maxLng = Math.max(bbox[0][0], bbox[1][0]);
  const maxLat = Math.max(bbox[0][1], bbox[1][1]);
  let x0 = mercatorX(minLng);
  let x1 = mercatorX(maxLng);
  let y0 = mercatorY(maxLat);
  let y1 = mercatorY(minLat);
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
  return { nw: lngLatFromMercator(x0, y0), se: lngLatFromMercator(x1, y1) };
}

/** Pixel mapping for a bbox framed by {@link fittedFrame}. */
export function projectorForBbox(
  bbox: BboxCorners,
  width: number,
  height: number,
): (lng: number, lat: number) => [number, number] {
  const fitted = fittedFrame(bbox, width, height);
  return projectorForFrame({ width, height, nw: fitted.nw, se: fitted.se });
}

/**
 * Camera that places {@link fittedFrame} on the canvas edges.
 * Bearing and pitch stay at 0, so one zoom fills both axes.
 */
export function cameraForFrame(frame: MapFrame): { center: [number, number]; zoom: number } {
  const x0 = mercatorX(frame.nw[0]);
  const x1 = mercatorX(frame.se[0]);
  const y0 = mercatorY(frame.nw[1]);
  const y1 = mercatorY(frame.se[1]);
  const worldSize = frame.width / (x1 - x0 || 1);
  return {
    center: lngLatFromMercator((x0 + x1) / 2, (y0 + y1) / 2),
    zoom: Math.log2(worldSize / MAP_TILE_SIZE),
  };
}
