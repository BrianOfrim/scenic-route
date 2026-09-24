/** Geography mask shared by the satellite photo and the satellite basemap. */

export type GeoMask = {
  /** [lng, lat] polygons kept in full. */
  rings?: [number, number][][];
  /** [lng, lat] lines stroked into the photo at `lineM` of padding on each side. */
  lines?: [number, number][][];
  /** Padding around `lines`, in meters. */
  lineM?: number;
  /** Corridor width in meters. One width, or one per route vertex. */
  bandM?: number | number[];
  /** Schematic features that meet the region are kept whole, so the canvas is not clipped. */
  whole?: boolean;
};

export type MapFrame = {
  width: number;
  height: number;
  /** Top-left of the image, [lng, lat]. */
  nw: [number, number];
  /** Bottom-right of the image, [lng, lat]. */
  se: [number, number];
};

const M_PER_DEG = 111_320;

export function maskIsActive(mask: GeoMask | null | undefined): boolean {
  if (!mask) return false;
  if (mask.rings?.some((ring) => ring.length >= 3)) return true;
  if ((mask.lineM ?? 0) > 0 && mask.lines?.some((line) => line.length >= 2)) return true;
  if (typeof mask.bandM === "number") return mask.bandM > 0;
  return Boolean(mask.bandM?.some((meters) => meters > 0));
}

/** North-up Web Mercator mapping that matches a fitted, unrotated map canvas. */
export function projectorForFrame(frame: MapFrame): (lng: number, lat: number) => [number, number] {
  const x0 = mercatorX(frame.nw[0]);
  const x1 = mercatorX(frame.se[0]);
  const y0 = mercatorY(frame.nw[1]);
  const y1 = mercatorY(frame.se[1]);
  const dx = x1 - x0 || 1;
  const dy = y1 - y0 || 1;
  return (lng, lat) => [((mercatorX(lng) - x0) / dx) * frame.width, ((mercatorY(lat) - y0) / dy) * frame.height];
}

/** Fill the kept region in opaque white. `route` is [lat, lng]. */
export function paintKeepRegion(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  mask: GeoMask,
  route: [number, number][],
) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const ring of mask.rings ?? []) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  const lineM = mask.lineM ?? 0;
  if (lineM > 0 && mask.lines?.length) {
    const anchor = route[Math.floor(route.length / 2)];
    const lng = anchor?.[1] ?? mask.lines[0]?.[0]?.[0] ?? 0;
    const lat = anchor?.[0] ?? mask.lines[0]?.[0]?.[1] ?? 0;
    ctx.lineWidth = Math.max(1, radiusPx(project, lng, lat, lineM) * 2);
    for (const line of mask.lines) {
      if (line.length < 2) continue;
      ctx.beginPath();
      line.forEach(([lngPoint, latPoint], index) => {
        const [x, y] = project(lngPoint, latPoint);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  if (!mask.bandM || route.length < 2) return;
  for (let i = 1; i < route.length; i += 1) {
    const meters = Math.max(bandMeters(mask.bandM, i - 1, route.length), bandMeters(mask.bandM, i, route.length));
    if (meters <= 0) continue;
    const [lat0, lng0] = route[i - 1];
    const [lat1, lng1] = route[i];
    const [x0, y0] = project(lng0, lat0);
    const [x1, y1] = project(lng1, lat1);
    ctx.lineWidth = Math.max(1, radiusPx(project, lng0, lat0, meters) * 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

/** Keep the photograph inside the mask and fill the rest black. Draw the route after this. */
export function maskImageToRegion(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  mask: GeoMask,
  route: [number, number][],
) {
  const layer = document.createElement("canvas");
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const maskCtx = layer.getContext("2d");
  if (!maskCtx) return;
  paintKeepRegion(maskCtx, project, mask, route);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Paint black over everything outside the mask, leaving the inside transparent. */
export function veilOutsideMask(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  mask: GeoMask,
  route: [number, number][],
  width: number,
  height: number,
) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-out";
  paintKeepRegion(ctx, project, mask, route);
  ctx.restore();
}

function bandMeters(band: number | number[], index: number, count: number): number {
  if (typeof band === "number") return band;
  if (band.length === count) return band[index] ?? 0;
  return band.reduce((max, meters) => Math.max(max, meters), 0);
}

function radiusPx(
  project: (lng: number, lat: number) => [number, number],
  lng: number,
  lat: number,
  meters: number,
): number {
  const [x, y] = project(lng, lat);
  const [x2, y2] = project(lng, lat + meters / M_PER_DEG);
  return Math.hypot(x2 - x, y2 - y);
}

function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const sine = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}
