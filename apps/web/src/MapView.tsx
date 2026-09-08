import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { Map, Marker, NavigationControl } from "./maplibre";
import type { NamedArea, NamedWay, PosterPoi, PosterWays } from "./api";
import { nearestTrailName } from "./poster/trailColors";
import {
  drawSchematicScene,
  schematicLineScale,
  type SchematicLayers,
} from "./poster/grounding/renderSchematic";

export type Basemap = "osm" | "schematic";

type SchematicHover = {
  kind: "poi" | "trail" | "area";
  name: string;
  label: string;
};

type HoverUi = {
  element: HTMLElement;
  show: (hit: SchematicHover | null, point: { x: number; y: number }) => void;
  hide: () => void;
  setActive: (active: boolean) => void;
  remove: () => void;
};

const POI_HIT_PX = 18;
const TRAIL_HIT_PX = 12;

type Props = {
  selectedLatLng: [number, number][] | null;
  cropLatLng?: [number, number][] | null;
  cropStops?: [number, number][];
  pois?: PosterPoi[];
  namedWays?: NamedWay[];
  namedAreas?: NamedArea[];
  ways?: PosterWays | null;
  schematicLayers?: SchematicLayers | null;
  basemap: Basemap;
  viewNonce?: number;
  onRemovePoi?: (name: string) => void;
  onRemoveArea?: (name: string) => void;
  onRemoveTrail?: (name: string) => void;
};

const DEFAULT_CENTER: [number, number] = [-112.83, 53.02];
const STREET_TILES = "/api/tiles/osm/{z}/{x}/{y}.png";

export function MapView({
  selectedLatLng,
  cropLatLng,
  cropStops,
  pois,
  namedWays,
  namedAreas,
  ways,
  schematicLayers,
  basemap,
  viewNonce = 0,
  onRemovePoi,
  onRemoveArea,
  onRemoveTrail,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<HoverUi | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const trackRef = useRef(selectedLatLng);
  const cropRef = useRef(cropLatLng);
  const stopsRef = useRef(cropStops);
  const poisRef = useRef(pois);
  const namedWaysRef = useRef(namedWays);
  const namedAreasRef = useRef(namedAreas);
  const waysRef = useRef(ways);
  const layersRef = useRef(schematicLayers);
  const onRemovePoiRef = useRef(onRemovePoi);
  const onRemoveAreaRef = useRef(onRemoveArea);
  const onRemoveTrailRef = useRef(onRemoveTrail);
  const basemapRef = useRef(basemap);
  trackRef.current = selectedLatLng;
  cropRef.current = cropLatLng;
  stopsRef.current = cropStops;
  poisRef.current = pois;
  namedWaysRef.current = namedWays;
  namedAreasRef.current = namedAreas;
  waysRef.current = ways;
  layersRef.current = schematicLayers;
  onRemovePoiRef.current = onRemovePoi;
  onRemoveAreaRef.current = onRemoveArea;
  onRemoveTrailRef.current = onRemoveTrail;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: styleFor(basemapRef.current),
      center: DEFAULT_CENTER,
      zoom: 10,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    for (const stale of map.getContainer().querySelectorAll("canvas.map-schematic")) stale.remove();
    const overlay = document.createElement("canvas");
    overlay.className = "map-schematic";
    overlay.hidden = basemapRef.current !== "schematic";
    overlay.setAttribute("aria-hidden", "true");
    const controls = map.getContainer().querySelector(".maplibregl-control-container");
    if (controls) map.getContainer().insertBefore(overlay, controls);
    else map.getContainer().appendChild(overlay);
    overlayRef.current = overlay;
    const hover = createSchematicHover(map, overlay, onRemovePoiRef, onRemoveAreaRef, onRemoveTrailRef);
    hover.setActive(basemapRef.current === "schematic");
    hoverRef.current = hover;
    mapRef.current = map;
    const paint = () => {
      map.resize();
      syncMapChrome(map, overlayRef.current, markersRef, basemapRef.current, {
        track: trackRef.current,
        crop: cropRef.current,
        stops: stopsRef.current,
        pois: poisRef.current,
        namedWays: namedWaysRef.current,
        namedAreas: namedAreasRef.current,
        ways: waysRef.current,
        layers: layersRef.current,
        onRemovePoi: onRemovePoiRef,
      });
      fit(map, cropRef.current ?? trackRef.current, 0);
    };
    const redrawSchematic = () => {
      paintSchematicOverlay(map, overlayRef.current, {
        latlng: cropRef.current ?? trackRef.current,
        ways: waysRef.current,
        layers: layersRef.current,
        pois: poisRef.current,
        namedWays: namedWaysRef.current,
        namedAreas: namedAreasRef.current,
        basemap: basemapRef.current,
      });
    };
    const onHoverMove = (event: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; originalEvent?: MouseEvent }) => {
      if (basemapRef.current !== "schematic") {
        hover.hide();
        return;
      }
      if (event.originalEvent?.buttons) {
        hover.hide();
        return;
      }
      hover.show(
        hitTestSchematic(
          map,
          event.point,
          event.lngLat,
          poisRef.current,
          namedWaysRef.current,
          namedAreasRef.current,
          cropRef.current ?? trackRef.current,
        ),
        event.point,
      );
    };
    const onHoverLeave = (event: { originalEvent?: { relatedTarget?: EventTarget | null } }) => {
      const next = event.originalEvent?.relatedTarget;
      if (next instanceof Node && hover.element.contains(next)) return;
      hover.hide();
    };
    map.on("load", paint);
    map.on("style.load", paint);
    map.on("render", redrawSchematic);
    map.on("mousemove", onHoverMove);
    map.on("mouseout", onHoverLeave);
    return () => {
      map.off("load", paint);
      map.off("style.load", paint);
      map.off("render", redrawSchematic);
      map.off("mousemove", onHoverMove);
      map.off("mouseout", onHoverLeave);
      clearMarkers(markersRef);
      hover.remove();
      if (hoverRef.current === hover) hoverRef.current = null;
      overlay.remove();
      if (overlayRef.current === overlay) overlayRef.current = null;
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    if (overlayRef.current) overlayRef.current.hidden = basemap !== "schematic";
    hoverRef.current?.setActive(basemap === "schematic");
    map.setStyle(styleFor(basemap));
    if (basemap !== "schematic") {
      clearSchematicOverlay(overlayRef.current);
      hoverRef.current?.hide();
    }
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (basemapRef.current === "schematic") {
        clearMarkers(markersRef);
        map.triggerRepaint();
        fit(map, cropLatLng ?? selectedLatLng, 600);
        return;
      }
      if (!drawOverlays(map, selectedLatLng, cropLatLng, cropStops, namedWaysRef.current, namedAreasRef.current)) {
        map.once("style.load", apply);
        return;
      }
      fit(map, cropLatLng ?? selectedLatLng, 600);
    };
    apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [selectedLatLng, cropLatLng, cropStops, viewNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === "schematic") {
      clearMarkers(markersRef);
      map.triggerRepaint();
      return;
    }
    const apply = () => syncPoiMarkers(map, markersRef, pois, onRemovePoiRef);
    apply();
    if (!map.loaded()) map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [pois]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === "schematic") {
      map.triggerRepaint();
      return;
    }
    const apply = () => {
      drawOverlays(map, trackRef.current, cropRef.current, stopsRef.current, namedWays, namedAreasRef.current);
    };
    apply();
    if (!map.loaded()) map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [namedWays]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === "schematic") {
      map.triggerRepaint();
      return;
    }
    const apply = () => {
      drawOverlays(map, trackRef.current, cropRef.current, stopsRef.current, namedWaysRef.current, namedAreas);
    };
    apply();
    if (!map.loaded()) map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [namedAreas]);

  useEffect(() => {
    mapRef.current?.triggerRepaint();
    hoverRef.current?.hide();
  }, [ways, schematicLayers, pois, namedWays, namedAreas]);

  return (
    <div className="map-root">
      <div ref={containerRef} className="map" />
    </div>
  );
}

function styleFor(basemap: Basemap): StyleSpecification {
  if (basemap === "schematic") {
    return {
      version: 8,
      sources: {},
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#f7f4ec" } },
      ],
    };
  }
  return {
    version: 8 as const,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      tiles: {
        type: "raster" as const,
        tiles: [STREET_TILES],
        tileSize: 256,
        attribution: "© OpenStreetMap",
      },
    },
    layers: [
      { id: "background", type: "background" as const, paint: { "background-color": "#1b1d16" } },
      { id: "tiles", type: "raster" as const, source: "tiles", paint: { "raster-opacity": 0.92 } },
    ],
  };
}

function syncMapChrome(
  map: Map,
  overlay: HTMLCanvasElement | null,
  markersRef: { current: Marker[] },
  basemap: Basemap,
  data: {
    track: [number, number][] | null;
    crop: [number, number][] | null | undefined;
    stops: [number, number][] | undefined;
    pois: PosterPoi[] | undefined;
    namedWays: NamedWay[] | undefined;
    namedAreas: NamedArea[] | undefined;
    ways: PosterWays | null | undefined;
    layers: SchematicLayers | null | undefined;
    onRemovePoi: { current?: (name: string) => void };
  },
) {
  if (basemap === "schematic") {
    clearMarkers(markersRef);
    paintSchematicOverlay(map, overlay, {
      latlng: data.crop ?? data.track,
      ways: data.ways,
      layers: data.layers,
      pois: data.pois,
      namedWays: data.namedWays,
      namedAreas: data.namedAreas,
      basemap,
    });
    return;
  }
  clearSchematicOverlay(overlay);
  if (!drawOverlays(map, data.track, data.crop, data.stops, data.namedWays, data.namedAreas)) return;
  syncPoiMarkers(map, markersRef, data.pois, data.onRemovePoi);
}

function paintSchematicOverlay(
  map: Map,
  canvas: HTMLCanvasElement | null,
  data: {
    latlng: [number, number][] | null | undefined;
    ways: PosterWays | null | undefined;
    layers: SchematicLayers | null | undefined;
    pois: PosterPoi[] | undefined;
    namedWays: NamedWay[] | undefined;
    namedAreas: NamedArea[] | undefined;
    basemap: Basemap;
  },
) {
  if (!canvas) return;
  canvas.hidden = data.basemap !== "schematic";
  if (data.basemap !== "schematic") return;
  const mapCanvas = map.getCanvas();
  const cssW = mapCanvas.clientWidth;
  const cssH = mapCanvas.clientHeight;
  if (cssW < 2 || cssH < 2) return;
  if (canvas.width !== mapCanvas.width || canvas.height !== mapCanvas.height) {
    canvas.width = mapCanvas.width;
    canvas.height = mapCanvas.height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const sx = canvas.width / cssW;
  const sy = canvas.height / cssH;
  const project = (lng: number, lat: number): [number, number] => {
    const point = map.project([lng, lat]);
    return [point.x * sx, point.y * sy];
  };
  drawSchematicScene(
    ctx,
    {
      latlng: data.latlng ?? [],
      ways: data.ways ?? undefined,
      pois: data.pois,
      namedWays: data.namedWays,
      namedAreas: data.namedAreas,
      layers: data.layers ?? undefined,
    },
    project,
    {
      width: canvas.width,
      height: canvas.height,
      lineScale: schematicLineScale(map.getZoom()) * ((sx + sy) / 2),
      northArrow: false,
    },
  );
}

function createSchematicHover(
  map: Map,
  overlay: HTMLCanvasElement,
  onRemovePoiRef: { current?: (name: string) => void },
  onRemoveAreaRef: { current?: (name: string) => void },
  onRemoveTrailRef: { current?: (name: string) => void },
): HoverUi {
  const root = document.createElement("div");
  root.className = "map-schematic-hits";
  root.hidden = true;
  const tip = document.createElement("div");
  tip.className = "map-schematic-tip";
  tip.hidden = true;
  const name = document.createElement("span");
  name.className = "map-schematic-tip-name";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "map-poi-remove";
  remove.textContent = "×";
  tip.append(name, remove);
  root.append(tip);
  const controls = map.getContainer().querySelector(".maplibregl-control-container");
  if (overlay.nextSibling) overlay.parentElement?.insertBefore(root, overlay.nextSibling);
  else if (controls) map.getContainer().insertBefore(root, controls);
  else map.getContainer().appendChild(root);

  let current: SchematicHover | null = null;
  let hideTimer = 0;
  const cancelHide = () => {
    if (!hideTimer) return;
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  };
  const hide = () => {
    cancelHide();
    current = null;
    tip.hidden = true;
  };
  const scheduleHide = () => {
    if (hideTimer || tip.hidden) return;
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (tip.matches(":hover")) return;
      hide();
    }, 250);
  };
  const pointerOnTip = (point: { x: number; y: number }) => {
    if (tip.hidden) return false;
    const pad = 10;
    const tipRect = tip.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const x = rootRect.left + point.x;
    const y = rootRect.top + point.y;
    return x >= tipRect.left - pad && x <= tipRect.right + pad && y >= tipRect.top - pad && y <= tipRect.bottom + pad;
  };
  const show = (hit: SchematicHover | null, point: { x: number; y: number }) => {
    if (!hit) {
      if (tip.matches(":hover") || pointerOnTip(point)) {
        cancelHide();
        return;
      }
      scheduleHide();
      return;
    }
    cancelHide();
    const same = current?.kind === hit.kind && current.name === hit.name;
    current = hit;
    name.textContent = hit.label;
    remove.setAttribute("aria-label", `Remove ${hit.name}`);
    remove.title = `Remove ${hit.name}`;
    if (!same || tip.hidden) {
      const maxX = Math.max(8, root.clientWidth - 220);
      const maxY = Math.max(8, root.clientHeight - 44);
      // Overlap the pointer so the name and × stay under the cursor.
      tip.style.transform = `translate(${Math.max(8, Math.min(maxX, point.x - 6))}px, ${Math.max(8, Math.min(maxY, point.y - 8))}px)`;
    }
    tip.hidden = false;
  };
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!current) return;
    if (current.kind === "area") onRemoveAreaRef.current?.(current.name);
    else if (current.kind === "trail") onRemoveTrailRef.current?.(current.name);
    else onRemovePoiRef.current?.(current.name);
    hide();
  });
  tip.addEventListener("mouseenter", () => cancelHide());
  tip.addEventListener("mouseleave", () => scheduleHide());
  return {
    element: tip,
    show,
    hide,
    setActive: (active) => {
      root.hidden = !active;
      if (!active) hide();
    },
    remove: () => {
      hide();
      root.remove();
    },
  };
}

function hitTestSchematic(
  map: Map,
  point: { x: number; y: number },
  lngLat: { lng: number; lat: number },
  pois: PosterPoi[] | undefined,
  trails: NamedWay[] | undefined,
  areas: NamedArea[] | undefined,
  route: [number, number][] | null | undefined,
): SchematicHover | null {
  const items = Array.isArray(pois) ? pois : [];
  let bestIndex = -1;
  let bestDist = POI_HIT_PX;
  for (let index = 0; index < items.length; index += 1) {
    const poi = items[index];
    const projected = map.project([poi.lng, poi.lat]);
    const dist = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (dist > bestDist) continue;
    bestIndex = index;
    bestDist = dist;
  }
  if (bestIndex >= 0) {
    const poi = items[bestIndex];
    return { kind: "poi", name: poi.name, label: `${bestIndex + 1} ${poi.name}` };
  }
  const trail = hitTestTrail(map, point, lngLat, trails, route);
  if (trail) return trail;
  const match = [...(areas ?? [])].reverse().find((area) => areaContains(area, lngLat.lat, lngLat.lng));
  if (!match) return null;
  return {
    kind: "area",
    name: match.name,
    label: match.letter ? `${match.letter} ${match.name}` : match.name,
  };
}

function hitTestTrail(
  map: Map,
  point: { x: number; y: number },
  lngLat: { lng: number; lat: number },
  trails: NamedWay[] | undefined,
  route: [number, number][] | null | undefined,
): SchematicHover | null {
  const items = Array.isArray(trails) ? trails : [];
  if (!items.length) return null;
  let bestOrder = items.length;
  for (let index = 0; index < items.length; index += 1) {
    if (distToWayPx(map, point, items[index].geometry.coordinates) > TRAIL_HIT_PX) continue;
    if (index < bestOrder) bestOrder = index;
  }
  if (bestOrder < items.length) {
    const trail = items[bestOrder];
    return { kind: "trail", name: trail.name, label: trail.name };
  }
  if (!route?.length) return null;
  let nearRoute = false;
  for (const [lat, lng] of route) {
    const projected = map.project([lng, lat]);
    if (Math.hypot(projected.x - point.x, projected.y - point.y) <= TRAIL_HIT_PX) {
      nearRoute = true;
      break;
    }
  }
  if (!nearRoute) return null;
  const name = nearestTrailName([lngLat.lat, lngLat.lng], items, undefined, route);
  if (!name) return null;
  return { kind: "trail", name, label: name };
}

function distToWayPx(map: Map, point: { x: number; y: number }, lines: number[][][]) {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (a.length < 2 || b.length < 2) continue;
      const from = map.project([a[0], a[1]]);
      const to = map.project([b[0], b[1]]);
      const dist = distToSegmentPx(point, from, to);
      if (dist < best) best = dist;
      if (best === 0) return 0;
    }
  }
  return best;
}

function distToSegmentPx(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
}

function areaContains(area: NamedArea, lat: number, lng: number) {
  return geometryContains(area.geometry, lat, lng);
}

function geometryContains(
  geometry: NamedArea["geometry"],
  lat: number,
  lng: number,
) {
  if (geometry.type === "Polygon") return polygonContains(geometry.coordinates, lng, lat);
  return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
}

function polygonContains(rings: number[][][], lng: number, lat: number) {
  if (!rings.length || !ringContains(rings[0], lng, lat)) return false;
  return !rings.slice(1).some((hole) => ringContains(hole, lng, lat));
}

function ringContains(ring: number[][], lng: number, lat: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function clearSchematicOverlay(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function lineCollection(latlng: [number, number][] | null | undefined): FeatureCollection {
  if (!latlng || latlng.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: latlng.map(([lat, lng]) => [lng, lat]) },
      },
    ],
  };
}

function stopsCollection(stops: [number, number][] | undefined): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (stops ?? []).map(([lat, lng]) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: [lng, lat] },
    })),
  };
}

function ensureSource(map: Map, id: string, data: FeatureCollection) {
  const source = map.getSource(id);
  if (source && "setData" in source) {
    (source as { setData: (data: FeatureCollection) => void }).setData(data);
    return;
  }
  if (!map.getSource(id)) {
    map.addSource(id, { type: "geojson", data });
  }
}

function namedWayCollection(trails: NamedWay[] | undefined): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (trails ?? []).map((trail) => ({
      type: "Feature" as const,
      properties: { name: trail.name },
      geometry: trail.geometry,
    })),
  };
}

function namedAreaCollection(areas: NamedArea[] | undefined): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (areas ?? []).map((area) => ({
      type: "Feature" as const,
      properties: { name: area.name },
      geometry: area.geometry,
    })),
  };
}

function drawOverlays(
  map: Map,
  selectedLatLng: [number, number][] | null,
  cropLatLng: [number, number][] | null | undefined,
  cropStops: [number, number][] | undefined,
  namedWays?: NamedWay[],
  namedAreas?: NamedArea[],
) {
  if (!map.getStyle()) return false;
  try {
    ensureSource(map, "named-areas", namedAreaCollection(namedAreas));
    ensureSource(map, "named-trails", namedWayCollection(namedWays));
    ensureSource(map, "full-track", lineCollection(selectedLatLng));
    ensureSource(map, "crop-track", lineCollection(cropLatLng ?? selectedLatLng));
    ensureSource(map, "crop-stops", stopsCollection(cropStops));
    addFill(map, "named-areas-fill", "named-areas", "#c49458", 0.28);
    addDash(map, "named-areas-line", "named-areas", "#966030");
    addLine(map, "named-trails-line", "named-trails", "#c2410c", 3, 0.85);
    addLine(map, "full-track-line", "full-track", "#52525b", 3, 0.4);
    addLine(map, "crop-track-casing", "crop-track", "#111111", 8, 0.9);
    addLine(map, "crop-track-line", "crop-track", "#e11d48", 4.5, 1);
    addStopLayer(map);
    return Boolean(map.getLayer("crop-track-line"));
  } catch {
    return false;
  }
}

function addStopLayer(map: Map) {
  if (map.getLayer("crop-stop-dots")) return;
  map.addLayer({
    id: "crop-stop-dots",
    type: "circle",
    source: "crop-stops",
    paint: {
      "circle-radius": 5,
      "circle-color": "#e8c36a",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#111111",
    },
  });
}

function addFill(map: Map, id: string, source: string, color: string, opacity: number) {
  if (map.getLayer(id)) return;
  map.addLayer({
    id,
    type: "fill",
    source,
    paint: { "fill-color": color, "fill-opacity": opacity },
  });
}

function addDash(map: Map, id: string, source: string, color: string) {
  if (map.getLayer(id)) return;
  map.addLayer({
    id,
    type: "line",
    source,
    paint: { "line-color": color, "line-width": 1.5, "line-dasharray": [2, 1], "line-opacity": 0.85 },
  });
}

function addLine(map: Map, id: string, source: string, color: string, width: number, opacity: number) {
  if (map.getLayer(id)) return;
  map.addLayer({
    id,
    type: "line",
    source,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": color, "line-width": width, "line-opacity": opacity },
  });
}

function clearMarkers(markersRef: { current: Marker[] }) {
  for (const marker of markersRef.current) marker.remove();
  markersRef.current = [];
}

function syncPoiMarkers(
  map: Map,
  markersRef: { current: Marker[] },
  pois: PosterPoi[] | undefined,
  onRemovePoiRef: { current?: (name: string) => void },
) {
  clearMarkers(markersRef);
  const items = Array.isArray(pois) ? pois : [];
  markersRef.current = items.map((poi, index) => {
    const root = document.createElement("div");
    root.className = "map-poi";
    const dot = document.createElement("span");
    dot.className = "map-poi-dot";
    const label = document.createElement("span");
    label.className = "map-poi-label";
    const name = document.createElement("span");
    name.className = "map-poi-name";
    name.textContent = `${index + 1} ${poi.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "map-poi-remove";
    remove.setAttribute("aria-label", `Remove ${poi.name}`);
    remove.title = `Remove ${poi.name}`;
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemovePoiRef.current?.(poi.name);
    });
    label.append(name, remove);
    root.append(dot, label);
    return new Marker({ element: root, anchor: "top" }).setLngLat([poi.lng, poi.lat]).addTo(map);
  });
}

function fit(map: Map, latlng: [number, number][] | null | undefined, duration: number) {
  if (!latlng || latlng.length < 2) return;
  let minLng = latlng[0][1];
  let minLat = latlng[0][0];
  let maxLng = latlng[0][1];
  let maxLat = latlng[0][0];
  for (const [lat, lng] of latlng) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 72, maxZoom: 14, duration },
  );
}
