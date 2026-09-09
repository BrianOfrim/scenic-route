import { useEffect, useRef, useState, type FormEvent } from "react";
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

export type Basemap = "osm" | "satellite" | "schematic";

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
const ROUTE_SNAP_PX = 16;

export type AnnotateMode = "browse" | "landmark" | "section";

type LandmarkDraft = { name: string; lat: number; lng: number };
type SectionDraft = { name: string; start: number; end: number };
type RenameDraft = { from: string; name: string };

type NameDraft =
  | { kind: "landmark"; name: string; lat: number; lng: number; x: number; y: number }
  | { kind: "section"; name: string; start: number; end: number; x: number; y: number }
  | { kind: "rename"; name: string; from: string; x: number; y: number };

type AnnotatePreview = {
  route: [number, number][] | null | undefined;
  start: number | null;
  end: number | null;
  pin: { lat: number; lng: number } | null;
};

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
  labelingEnabled?: boolean;
  onRemovePoi?: (name: string) => void;
  onRemoveArea?: (name: string) => void;
  onRemoveTrail?: (name: string) => void;
  onNeedSchematic?: () => void;
  onPlaceLandmark?: (draft: LandmarkDraft) => void;
  onPlaceSection?: (draft: SectionDraft) => void;
  onRenameTrail?: (draft: RenameDraft) => void;
};

const DEFAULT_CENTER: [number, number] = [-112.83, 53.02];
const STREET_TILES = "/api/tiles/osm/{z}/{x}/{y}.png";
const SATELLITE_TILES = "/api/tiles/satellite/{z}/{x}/{y}.png";

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
  labelingEnabled = false,
  onRemovePoi,
  onRemoveArea,
  onRemoveTrail,
  onNeedSchematic,
  onPlaceLandmark,
  onPlaceSection,
  onRenameTrail,
}: Props) {
  const [mode, setMode] = useState<AnnotateMode>("browse");
  const [hint, setHint] = useState<string | null>(null);
  const [draft, setDraft] = useState<NameDraft | null>(null);
  const [sectionStart, setSectionStart] = useState<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
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
  const onNeedSchematicRef = useRef(onNeedSchematic);
  const onPlaceLandmarkRef = useRef(onPlaceLandmark);
  const onPlaceSectionRef = useRef(onPlaceSection);
  const onRenameTrailRef = useRef(onRenameTrail);
  const onRenameTrailStartRef = useRef<(name: string, point: { x: number; y: number }) => void>(() => {});
  const basemapRef = useRef(basemap);
  const modeRef = useRef(mode);
  const draftRef = useRef(draft);
  const sectionStartRef = useRef(sectionStart);
  const sectionHoverRef = useRef<number | null>(null);
  const labelingRef = useRef(labelingEnabled);
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
  onNeedSchematicRef.current = onNeedSchematic;
  onPlaceLandmarkRef.current = onPlaceLandmark;
  onPlaceSectionRef.current = onPlaceSection;
  onRenameTrailRef.current = onRenameTrail;
  onRenameTrailStartRef.current = (name, point) => {
    setMode("browse");
    setSectionStart(null);
    sectionHoverRef.current = null;
    setDraft({ kind: "rename", name, from: name, x: point.x, y: point.y });
    setHint("Rename this stretch");
  };
  modeRef.current = mode;
  draftRef.current = draft;
  sectionStartRef.current = sectionStart;
  labelingRef.current = labelingEnabled;

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
    const hover = createSchematicHover(
      map,
      overlay,
      onRemovePoiRef,
      onRemoveAreaRef,
      onRemoveTrailRef,
      onRenameTrailStartRef,
    );
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
        preview: annotatePreview(cropRef.current ?? trackRef.current, sectionStartRef.current, sectionHoverRef.current, draftRef.current),
      });
    };
    const onAnnotateClick = (event: {
      point: { x: number; y: number };
      lngLat: { lng: number; lat: number };
      originalEvent?: MouseEvent;
    }) => {
      if (!labelingRef.current || basemapRef.current !== "schematic") return;
      if (modeRef.current === "browse") return;
      const target = event.originalEvent?.target;
      if (target instanceof Element && (target.closest(".map-annotate") || target.closest(".map-schematic-tip"))) return;
      const route = cropRef.current ?? trackRef.current;
      if (modeRef.current === "landmark") {
        const keep = draftRef.current?.kind === "landmark" ? draftRef.current.name : "";
        setDraft({
          kind: "landmark",
          name: keep,
          lat: event.lngLat.lat,
          lng: event.lngLat.lng,
          x: event.point.x,
          y: event.point.y,
        });
        setHint("Name this landmark");
        map.triggerRepaint();
        return;
      }
      const hit = nearestRouteIndexPx(map, event.point, route);
      if (!hit) {
        setHint("Click the GPS track to mark a stretch");
        return;
      }
      const start = sectionStartRef.current;
      if (start == null) {
        setSectionStart(hit.index);
        sectionHoverRef.current = hit.index;
        setHint("Click the other end of the stretch");
        map.triggerRepaint();
        return;
      }
      if (hit.index === start) {
        setHint("Click a different point on the track");
        return;
      }
      setDraft({
        kind: "section",
        name: draftRef.current?.kind === "section" ? draftRef.current.name : "",
        start,
        end: hit.index,
        x: event.point.x,
        y: event.point.y,
      });
      sectionHoverRef.current = hit.index;
      setHint("Name this stretch");
      map.triggerRepaint();
    };
    const onHoverMove = (event: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; originalEvent?: MouseEvent }) => {
      if (basemapRef.current !== "schematic") {
        hover.hide();
        return;
      }
      if (modeRef.current !== "browse") {
        hover.hide();
        if (modeRef.current === "section" && sectionStartRef.current != null) {
          const hit = nearestRouteIndexPx(map, event.point, cropRef.current ?? trackRef.current);
          const next = hit?.index ?? sectionHoverRef.current;
          if (next !== sectionHoverRef.current) {
            sectionHoverRef.current = next;
            map.triggerRepaint();
          }
        }
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
    map.on("click", onAnnotateClick);
    map.on("mousemove", onHoverMove);
    map.on("mouseout", onHoverLeave);
    return () => {
      map.off("load", paint);
      map.off("style.load", paint);
      map.off("render", redrawSchematic);
      map.off("click", onAnnotateClick);
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

  useEffect(() => {
    setMode("browse");
    setDraft(null);
    setSectionStart(null);
    setHint(null);
    sectionHoverRef.current = null;
    mapRef.current?.triggerRepaint();
  }, [labelingEnabled, viewNonce]);

  const draftAnchor = draft
    ? draft.kind === "landmark"
      ? `landmark:${draft.lat},${draft.lng}`
      : draft.kind === "section"
        ? `section:${draft.start}:${draft.end}`
        : `rename:${draft.from}`
    : null;

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = mode === "browse" || basemap !== "schematic" ? "" : "crosshair";
    mapRef.current?.triggerRepaint();
  }, [mode, basemap, draftAnchor, sectionStart]);

  useEffect(() => {
    if (!draftAnchor) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [draftAnchor]);

  useEffect(() => {
    if (mode === "browse" && !draft) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (draft) {
        setDraft(null);
        setHint(
          draft.kind === "rename"
            ? null
            : mode === "landmark"
              ? "Click the schematic to place a landmark"
              : "Click the start of the stretch",
        );
        if (mode === "section") {
          setSectionStart(null);
          sectionHoverRef.current = null;
        }
        mapRef.current?.triggerRepaint();
        return;
      }
      if (sectionStart != null) {
        setSectionStart(null);
        sectionHoverRef.current = null;
        setHint("Click the start of the stretch");
        mapRef.current?.triggerRepaint();
        return;
      }
      setMode("browse");
      setHint(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draft, sectionStart]);

  function toggleMode(next: AnnotateMode) {
    const chosen = mode === next ? "browse" : next;
    setMode(chosen);
    setDraft(null);
    setSectionStart(null);
    sectionHoverRef.current = null;
    if (chosen === "browse") {
      setHint(null);
    } else {
      onNeedSchematicRef.current?.();
      setHint(chosen === "landmark" ? "Click the schematic to place a landmark" : "Click the start of the stretch");
    }
    mapRef.current?.triggerRepaint();
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    if (draft.kind === "landmark") {
      onPlaceLandmarkRef.current?.({ name, lat: draft.lat, lng: draft.lng });
      setHint("Click to place another landmark");
    } else if (draft.kind === "section") {
      onPlaceSectionRef.current?.({ name, start: draft.start, end: draft.end });
      setHint("Click the start of another stretch");
    } else {
      const taken = (namedWaysRef.current ?? []).map((trail) => trail.name);
      if (taken.some((item) => item !== draft.from && item.trim().toLowerCase() === name.toLowerCase())) {
        setHint(`“${name}” is already a named stretch`);
        return;
      }
      onRenameTrailRef.current?.({ from: draft.from, name });
      setHint(`Renamed stretch to “${name}”`);
    }
    setDraft(null);
    setSectionStart(null);
    sectionHoverRef.current = null;
    mapRef.current?.triggerRepaint();
  }

  return (
    <div className={`map-root${mode !== "browse" ? ` is-annotate-${mode}` : ""}`}>
      <div ref={containerRef} className="map" />
      {labelingEnabled && (
        <div className="map-annotate">
          <div className="map-annotate-tools" role="toolbar" aria-label="Schematic labels">
            <button
              type="button"
              className={`text-btn${mode === "landmark" ? " on" : ""}`}
              aria-pressed={mode === "landmark"}
              onClick={() => toggleMode("landmark")}
            >
              Place landmark
            </button>
            <button
              type="button"
              className={`text-btn${mode === "section" ? " on" : ""}`}
              aria-pressed={mode === "section"}
              onClick={() => toggleMode("section")}
            >
              Name stretch
            </button>
          </div>
          {(hint || (mode !== "browse" && basemap !== "schematic")) && (
            <p className="map-annotate-hint">
              {basemap !== "schematic" && mode !== "browse"
                ? "Switching to the schematic…"
                : hint}
            </p>
          )}
          {draft && (
            <form
              className="map-annotate-form"
              style={{
                transform: `translate(${Math.max(8, draft.x)}px, ${Math.max(8, draft.y + 12)}px)`,
              }}
              onSubmit={submitDraft}
            >
              <label className="map-annotate-label">
                {draft.kind === "landmark" ? "Landmark name" : draft.kind === "rename" ? "Rename stretch" : "Stretch name"}
                <input
                  ref={nameInputRef}
                  className="search"
                  value={draft.name}
                  placeholder={draft.kind === "landmark" ? "e.g. The old oak" : "e.g. Grandma's hill"}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <div className="map-annotate-actions">
                <button className="button" type="submit" disabled={!draft.name.trim()}>
                  {draft.kind === "rename" ? "Save" : "Add"}
                </button>
                <button
                  className="text-btn"
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    if (draft.kind === "section") {
                      setSectionStart(null);
                      sectionHoverRef.current = null;
                    }
                    setHint(
                      draft.kind === "rename"
                        ? null
                        : draft.kind === "landmark"
                          ? "Click the schematic to place a landmark"
                          : "Click the start of the stretch",
                    );
                    mapRef.current?.triggerRepaint();
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
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
  if (basemap === "satellite") {
    return rasterStyle(SATELLITE_TILES, "Esri World Imagery", "#111318", 1);
  }
  return rasterStyle(STREET_TILES, "© OpenStreetMap", "#1b1d16", 0.92);
}

function rasterStyle(
  tiles: string,
  attribution: string,
  background: string,
  opacity: number,
): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      tiles: {
        type: "raster",
        tiles: [tiles],
        tileSize: 256,
        attribution,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": background } },
      { id: "tiles", type: "raster", source: "tiles", paint: { "raster-opacity": opacity } },
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
    preview?: AnnotatePreview | null;
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
  const lineScale = schematicLineScale(map.getZoom()) * ((sx + sy) / 2);
  paintAnnotatePreview(ctx, project, data.preview, lineScale);
}

function annotatePreview(
  route: [number, number][] | null | undefined,
  start: number | null,
  hover: number | null,
  draft: NameDraft | null,
): AnnotatePreview {
  if (draft?.kind === "landmark") {
    return { route, start: null, end: null, pin: { lat: draft.lat, lng: draft.lng } };
  }
  if (draft?.kind === "section") {
    return { route, start: draft.start, end: draft.end, pin: null };
  }
  return { route, start, end: hover, pin: null };
}

function paintAnnotatePreview(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  preview: AnnotatePreview | null | undefined,
  lineScale: number,
) {
  if (!preview) return;
  const route = preview.route;
  if (route && preview.start != null && preview.end != null) {
    const lo = Math.min(preview.start, preview.end);
    const hi = Math.max(preview.start, preview.end);
    ctx.beginPath();
    for (let i = lo; i <= hi && i < route.length; i += 1) {
      const [lat, lng] = route[i];
      const [x, y] = project(lng, lat);
      if (i === lo) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = Math.max(3, 5 * lineScale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    for (const index of [lo, hi]) {
      if (!route[index]) continue;
      const [lat, lng] = route[index];
      const [x, y] = project(lng, lat);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, 5 * lineScale), 0, Math.PI * 2);
      ctx.fillStyle = "#1b1812";
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, 2 * lineScale);
      ctx.strokeStyle = "#c9a227";
      ctx.stroke();
    }
  }
  if (!preview.pin) return;
  const [x, y] = project(preview.pin.lng, preview.pin.lat);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(5, 7 * lineScale), 0, Math.PI * 2);
  ctx.fillStyle = "#1b1812";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, 2 * lineScale);
  ctx.strokeStyle = "#c9a227";
  ctx.stroke();
}

function nearestRouteIndexPx(
  map: Map,
  point: { x: number; y: number },
  route: [number, number][] | null | undefined,
): { index: number; distPx: number } | null {
  if (!route?.length) return null;
  let bestIndex = 0;
  let bestDist = Infinity;
  if (route.length === 1) {
    const projected = map.project([route[0][1], route[0][0]]);
    const dist = Math.hypot(projected.x - point.x, projected.y - point.y);
    return dist <= ROUTE_SNAP_PX ? { index: 0, distPx: dist } : null;
  }
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = map.project([route[i][1], route[i][0]]);
    const to = map.project([route[i + 1][1], route[i + 1][0]]);
    const { dist, t } = distToSegmentPxT(point, from, to);
    if (dist >= bestDist) continue;
    bestDist = dist;
    bestIndex = t < 0.5 ? i : i + 1;
  }
  if (bestDist > ROUTE_SNAP_PX) return null;
  return { index: bestIndex, distPx: bestDist };
}

function distToSegmentPxT(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return { dist: Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y), t };
}

function createSchematicHover(
  map: Map,
  overlay: HTMLCanvasElement,
  onRemovePoiRef: { current?: (name: string) => void },
  onRemoveAreaRef: { current?: (name: string) => void },
  onRemoveTrailRef: { current?: (name: string) => void },
  onRenameTrailStartRef: { current?: (name: string, point: { x: number; y: number }) => void },
): HoverUi {
  const root = document.createElement("div");
  root.className = "map-schematic-hits";
  root.hidden = true;
  const tip = document.createElement("div");
  tip.className = "map-schematic-tip";
  tip.hidden = true;
  const name = document.createElement("span");
  name.className = "map-schematic-tip-name";
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "map-schematic-tip-name is-rename";
  rename.hidden = true;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "map-poi-remove";
  remove.textContent = "×";
  tip.append(name, rename, remove);
  root.append(tip);
  const controls = map.getContainer().querySelector(".maplibregl-control-container");
  if (overlay.nextSibling) overlay.parentElement?.insertBefore(root, overlay.nextSibling);
  else if (controls) map.getContainer().insertBefore(root, controls);
  else map.getContainer().appendChild(root);

  let current: SchematicHover | null = null;
  let lastPoint = { x: 0, y: 0 };
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
    lastPoint = point;
    const trail = hit.kind === "trail";
    name.hidden = trail;
    rename.hidden = !trail;
    if (trail) {
      rename.textContent = hit.label;
      rename.setAttribute("aria-label", `Rename ${hit.name}`);
      rename.title = `Rename ${hit.name}`;
    } else {
      name.textContent = hit.label;
    }
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
  rename.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (current?.kind !== "trail") return;
    onRenameTrailStartRef.current?.(current.name, lastPoint);
    hide();
  });
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
