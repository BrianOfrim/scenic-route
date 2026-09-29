import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { Map, Marker, NavigationControl } from "./maplibre";
import { canvasBitmapCollapsed, DEFAULT_MAX_CANVAS } from "./mapCanvas";
import type { NamedArea, NamedWay, PosterPoi, PosterWays } from "./api";
import { nearestTrailName } from "./poster/trailColors";
import { maskIsActive, veilOutsideMask, type GeoMask } from "./poster/grounding/geoMask";
import type { GeoEdit } from "./poster/polygonEdit";
import { isClosedLoop } from "./poster/crop";
import {
  drawRouteEndMarkers,
  drawSchematicScene,
  schematicLineScale,
  type SchematicLayers,
} from "./poster/grounding/renderSchematic";

export type Basemap = "osm" | "satellite" | "schematic";

export type LandmarkHighlight = {
  kind: "poi" | "trail" | "area";
  name: string;
};

type SchematicHover = LandmarkHighlight & {
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
const LANDMARK_DRAG_PX = 5;
const TOUCH_POI_HIT_PX = 28;
const TOUCH_TRAIL_HIT_PX = 22;
const TOUCH_ROUTE_SNAP_PX = 28;
const TOUCH_LANDMARK_DRAG_PX = 12;

type LandmarkDrag = {
  name: string;
  lat: number;
  lng: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export type AnnotateMode = "browse" | "landmark" | "section";

type LandmarkDraft = { name: string; lat: number; lng: number };
type SectionDraft = { name: string; start: number; end: number };
type RenameDraft = { from: string; name: string };

type NameDraft =
  | { kind: "landmark"; name: string; lat: number; lng: number; x: number; y: number }
  | { kind: "section"; name: string; start: number; end: number; x: number; y: number }
  | { kind: "rename"; target: "landmark" | "trail"; name: string; from: string; x: number; y: number };

type AnnotatePreview = {
  route: [number, number][] | null | undefined;
  start: number | null;
  end: number | null;
  pin: { lat: number; lng: number } | null;
};

type Props = {
  selectedLatLng: [number, number][] | null;
  selectedRouteBreaks?: number[];
  trackLoading?: boolean;
  cropLatLng?: [number, number][] | null;
  cropRouteBreaks?: number[];
  cropStops?: [number, number][];
  pois?: PosterPoi[];
  namedWays?: NamedWay[];
  namedAreas?: NamedArea[];
  ways?: PosterWays | null;
  schematicLayers?: SchematicLayers | null;
  basemap: Basemap;
  viewNonce?: number;
  labelingEnabled?: boolean;
  highlight?: LandmarkHighlight | null;
  touchUi?: boolean;
  /** Extra bottom inset (px) so fitBounds keeps the route above a sheet/overlay. */
  fitPaddingBottom?: number;
  onRemovePoi?: (name: string) => void;
  onRemoveArea?: (name: string) => void;
  onRemoveTrail?: (name: string) => void;
  onNeedSchematic?: () => void;
  onPlaceLandmark?: (draft: LandmarkDraft) => void;
  onMoveLandmark?: (draft: LandmarkDraft) => void;
  onPlaceSection?: (draft: SectionDraft) => void;
  editTrailExtent?: { name: string; nonce: number } | null;
  onRenameLandmark?: (draft: RenameDraft) => void;
  onRenameTrail?: (draft: RenameDraft) => void;
  /** Lng/lat vertices of a geography outline. */
  geoOutline?: [number, number][];
  geoOutlineActive?: boolean;
  geoOutlinePreview?: boolean;
  geoOutlineKind?: "polygon" | "rectangle";
  geoOutlineSelected?: number | null;
  geoRectPending?: boolean;
  geoMask?: GeoMask | null;
  onGeoEdit?: (edit: GeoEdit) => void;
};

const DEFAULT_CENTER: [number, number] = [-112.83, 53.02];
const STREET_TILES = "/api/tiles/osm/{z}/{x}/{y}.png";
const SATELLITE_TILES = "/api/tiles/satellite/{z}/{x}/{y}.png";

export function MapView({
  selectedLatLng,
  selectedRouteBreaks = [],
  trackLoading = false,
  cropLatLng,
  cropRouteBreaks = [],
  cropStops,
  pois,
  namedWays,
  namedAreas,
  ways,
  schematicLayers,
  basemap,
  viewNonce = 0,
  labelingEnabled = false,
  highlight = null,
  touchUi = false,
  fitPaddingBottom = 0,
  onRemovePoi,
  onRemoveArea,
  onRemoveTrail,
  onNeedSchematic,
  onPlaceLandmark,
  onMoveLandmark,
  onPlaceSection,
  editTrailExtent,
  onRenameLandmark,
  onRenameTrail,
  geoOutline,
  geoOutlineActive = false,
  geoOutlinePreview = false,
  geoOutlineKind = "polygon",
  geoOutlineSelected = null,
  geoRectPending = false,
  geoMask = null,
  onGeoEdit,
}: Props) {
  const [mode, setMode] = useState<AnnotateMode>("browse");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [draft, setDraft] = useState<NameDraft | null>(null);
  const [selectedHit, setSelectedHit] = useState<SchematicHover | null>(null);
  const [sectionStart, setSectionStart] = useState<number | null>(null);
  const [sectionEditName, setSectionEditName] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<HoverUi | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const trackRef = useRef(selectedLatLng);
  const trackBreaksRef = useRef(selectedRouteBreaks);
  const cropRef = useRef(cropLatLng);
  const cropBreaksRef = useRef(cropRouteBreaks);
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
  const onMoveLandmarkRef = useRef(onMoveLandmark);
  const onPlaceSectionRef = useRef(onPlaceSection);
  const landmarkDragRef = useRef<LandmarkDrag | null>(null);
  const skipAnnotateClickRef = useRef(false);
  const onRenameLandmarkRef = useRef(onRenameLandmark);
  const onRenameTrailRef = useRef(onRenameTrail);
  const geoOutlineRef = useRef(geoOutline);
  const geoOutlineActiveRef = useRef(geoOutlineActive);
  const geoOutlinePreviewRef = useRef(geoOutlinePreview);
  const geoKindRef = useRef(geoOutlineKind);
  const geoSelectedRef = useRef(geoOutlineSelected);
  const geoRectPendingRef = useRef(geoRectPending);
  const onGeoEditRef = useRef(onGeoEdit);
  const geoMaskRef = useRef(geoMask);
  const geoDragRef = useRef<{ index: number } | null>(null);
  const onRenameLandmarkStartRef = useRef<(name: string, point: { x: number; y: number }) => void>(() => {});
  const onRenameTrailStartRef = useRef<(name: string, point: { x: number; y: number }) => void>(() => {});
  const basemapRef = useRef(basemap);
  const styleReadyRef = useRef(false);
  const modeRef = useRef(mode);
  const draftRef = useRef(draft);
  const sectionStartRef = useRef(sectionStart);
  const sectionEditNameRef = useRef(sectionEditName);
  const sectionHoverRef = useRef<number | null>(null);
  const labelingRef = useRef(labelingEnabled);
  const highlightRef = useRef(highlight);
  const touchUiRef = useRef(touchUi);
  const fitPaddingBottomRef = useRef(fitPaddingBottom);
  const selectedHitRef = useRef(selectedHit);
  trackRef.current = selectedLatLng;
  trackBreaksRef.current = selectedRouteBreaks;
  cropRef.current = cropLatLng;
  cropBreaksRef.current = cropRouteBreaks;
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
  onMoveLandmarkRef.current = onMoveLandmark;
  onPlaceSectionRef.current = onPlaceSection;
  onRenameLandmarkRef.current = onRenameLandmark;
  highlightRef.current = highlight;
  touchUiRef.current = touchUi;
  fitPaddingBottomRef.current = fitPaddingBottom;
  selectedHitRef.current = selectedHit;
  onRenameLandmarkStartRef.current = (name, point) => {
    setMode("browse");
    setSectionStart(null);
    sectionHoverRef.current = null;
    setDraft({ kind: "rename", target: "landmark", name, from: name, x: point.x, y: point.y });
    setHint("Rename this landmark");
  };
  onRenameTrailRef.current = onRenameTrail;
  geoOutlineRef.current = geoOutline;
  geoOutlineActiveRef.current = geoOutlineActive;
  geoOutlinePreviewRef.current = geoOutlinePreview;
  geoKindRef.current = geoOutlineKind;
  geoSelectedRef.current = geoOutlineSelected;
  geoRectPendingRef.current = geoRectPending;
  onGeoEditRef.current = onGeoEdit;
  geoMaskRef.current = geoMask;
  onRenameTrailStartRef.current = (name, point) => {
    setMode("browse");
    setSectionStart(null);
    sectionHoverRef.current = null;
    setDraft({ kind: "rename", target: "trail", name, from: name, x: point.x, y: point.y });
    setHint("Rename this stretch");
  };
  modeRef.current = mode;
  draftRef.current = draft;
  sectionStartRef.current = sectionStart;
  sectionEditNameRef.current = sectionEditName;
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
    overlay.hidden = false;
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
      onRenameLandmarkStartRef,
      onRenameTrailStartRef,
    );
    hover.setActive(basemapRef.current === "schematic" && !touchUiRef.current);
    hoverRef.current = hover;
    mapRef.current = map;
    const paint = () => {
      resizeMap(map);
      const height = map.getContainer().clientHeight || 1;
      const bottom =
        fitPaddingBottomRef.current > 0
          ? Math.min(
              fitPaddingBottomRef.current + FIT_EDGE_PX + FIT_SHEET_GAP_PX,
              Math.floor(height * FIT_MAX_BOTTOM_RATIO),
            )
          : 0;
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      syncMapChrome(map, overlayRef.current, markersRef, basemapRef.current, {
        track: trackRef.current,
        trackBreaks: trackBreaksRef.current,
        crop: cropRef.current,
        cropBreaks: cropBreaksRef.current,
        stops: stopsRef.current,
        pois: poisRef.current,
        namedWays: namedWaysRef.current,
        namedAreas: namedAreasRef.current,
        ways: waysRef.current,
        layers: layersRef.current,
        highlight: highlightRef.current,
        onRemovePoi: onRemovePoiRef,
        onMoveLandmark: onMoveLandmarkRef,
        labeling: labelingRef,
        onMovedLandmark: (name) => setHint(`Moved ${name}`),
        geoMask: geoMaskRef.current,
      });
      fit(map, cropRef.current ?? trackRef.current, 0, bottom);
    };
    const redrawSchematic = () => {
      paintSchematicOverlay(map, overlayRef.current, {
        latlng: cropRef.current ?? trackRef.current,
        routeBreaks: cropRef.current ? cropBreaksRef.current : trackBreaksRef.current,
        stops: stopsRef.current,
        ways: waysRef.current,
        layers: layersRef.current,
        pois: poisWithDrag(poisRef.current, landmarkDragRef.current),
        namedWays: namedWaysRef.current,
        namedAreas: namedAreasRef.current,
        basemap: basemapRef.current,
        highlight: highlightRef.current,
        preview: annotatePreview(cropRef.current ?? trackRef.current, sectionStartRef.current, sectionHoverRef.current, draftRef.current),
        geoOutline: geoOutlineRef.current,
        geoOutlineActive: geoOutlineActiveRef.current,
        geoOutlinePreview: geoOutlinePreviewRef.current,
        geoOutlineSelected: geoSelectedRef.current,
        geoMask: geoMaskRef.current,
      });
    };
    const onAnnotateClick = (event: {
      point: { x: number; y: number };
      lngLat: { lng: number; lat: number };
      originalEvent?: MouseEvent;
    }) => {
      if (skipAnnotateClickRef.current) {
        skipAnnotateClickRef.current = false;
        return;
      }
      const target = event.originalEvent?.target;
      if (target instanceof Element && (target.closest(".map-annotate") || target.closest(".map-schematic-tip"))) return;
      if (geoOutlineActiveRef.current) {
        const kind = geoKindRef.current;
        const points = geoOutlineRef.current ?? [];
        if (kind === "rectangle") {
          if (geoRectPendingRef.current) {
            onGeoEditRef.current?.({ type: "rect-commit", lng: event.lngLat.lng, lat: event.lngLat.lat });
            map.triggerRepaint();
            return;
          }
          const hit = hitOutlineVertex(map, event.point, points, touchUiRef.current);
          if (hit != null) {
            onGeoEditRef.current?.({ type: "select", index: hit });
            return;
          }
          onGeoEditRef.current?.({ type: "rect-start", lng: event.lngLat.lng, lat: event.lngLat.lat });
          map.triggerRepaint();
          return;
        }
        const hit = hitOutlineVertex(map, event.point, points, touchUiRef.current);
        if (hit != null) {
          onGeoEditRef.current?.({ type: "select", index: hit });
          return;
        }
        onGeoEditRef.current?.({ type: "add", lng: event.lngLat.lng, lat: event.lngLat.lat });
        map.triggerRepaint();
        return;
      }
      if (!labelingRef.current || basemapRef.current !== "schematic") return;
      if (modeRef.current === "browse") {
        if (!touchUiRef.current) return;
        const hit = hitTestSchematic(
          map,
          event.point,
          event.lngLat,
          poisRef.current,
          namedWaysRef.current,
          namedAreasRef.current,
          cropRef.current ?? trackRef.current,
          touchUiRef.current,
        );
        setSelectedHit(hit);
        hover.hide();
        return;
      }
      setSelectedHit(null);
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
      const hit = nearestRouteIndexPx(map, event.point, route, touchUiRef.current);
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
        name: sectionEditNameRef.current || (draftRef.current?.kind === "section" ? draftRef.current.name : ""),
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
      if (geoDragRef.current) {
        hover.hide();
        onGeoEditRef.current?.({
          type: "move",
          index: geoDragRef.current.index,
          lng: event.lngLat.lng,
          lat: event.lngLat.lat,
        });
        map.getCanvas().style.cursor = "grabbing";
        map.triggerRepaint();
        return;
      }
      if (geoOutlineActiveRef.current) {
        hover.hide();
        if (geoRectPendingRef.current) {
          onGeoEditRef.current?.({ type: "rect-preview", lng: event.lngLat.lng, lat: event.lngLat.lat });
          map.triggerRepaint();
        }
        const hit = hitOutlineVertex(map, event.point, geoOutlineRef.current ?? [], touchUiRef.current);
        map.getCanvas().style.cursor = hit != null ? "grab" : "crosshair";
        return;
      }
      if (touchUiRef.current) {
        hover.hide();
        return;
      }
      if (basemapRef.current !== "schematic") {
        hover.hide();
        return;
      }
      if (landmarkDragRef.current?.moved) {
        hover.hide();
        map.getCanvas().style.cursor = "grabbing";
        return;
      }
      if (modeRef.current !== "browse") {
        hover.hide();
        if (modeRef.current === "section" && sectionStartRef.current != null) {
          const hit = nearestRouteIndexPx(map, event.point, cropRef.current ?? trackRef.current, touchUiRef.current);
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
      const hit = hitTestSchematic(
        map,
        event.point,
        event.lngLat,
        poisRef.current,
        namedWaysRef.current,
        namedAreasRef.current,
        cropRef.current ?? trackRef.current,
        false,
      );
      map.getCanvas().style.cursor = hit?.kind === "poi" && labelingRef.current ? "grab" : "";
      hover.show(hit, event.point);
    };
    const onHoverLeave = (event: { originalEvent?: { relatedTarget?: EventTarget | null } }) => {
      const next = event.originalEvent?.relatedTarget;
      if (next instanceof Node && hover.element.contains(next)) return;
      hover.hide();
    };
    const onLandmarkPointerDown = (event: {
      point: { x: number; y: number };
      lngLat: { lng: number; lat: number };
      originalEvent?: Event;
    }) => {
      if (geoOutlineActiveRef.current) {
        if (geoRectPendingRef.current) return;
        const hit = hitOutlineVertex(map, event.point, geoOutlineRef.current ?? [], touchUiRef.current);
        if (hit == null) return;
        const kind = geoKindRef.current;
        if (kind !== "polygon" && kind !== "rectangle") return;
        geoDragRef.current = { index: hit };
        onGeoEditRef.current?.({ type: "move-start", index: hit });
        onGeoEditRef.current?.({ type: "select", index: hit });
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
        skipAnnotateClickRef.current = true;
        return;
      }
      if (!labelingRef.current || modeRef.current !== "browse" || draftRef.current) return;
      const target = event.originalEvent?.target;
      if (target instanceof Element && (target.closest(".map-annotate") || target.closest(".map-schematic-tip"))) {
        return;
      }
      const pois = poisWithDrag(poisRef.current, landmarkDragRef.current);
      const poi =
        basemapRef.current === "schematic"
          ? hitTestPoi(map, event.point, pois, touchUiRef.current)
          : null;
      if (!poi) return;
      landmarkDragRef.current = {
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
        startX: event.point.x,
        startY: event.point.y,
        moved: false,
      };
      map.dragPan.disable();
      hover.hide();
    };
    const onLandmarkPointerMove = (event: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
      const drag = landmarkDragRef.current;
      if (!drag) return;
      const dist = Math.hypot(event.point.x - drag.startX, event.point.y - drag.startY);
      const threshold = touchUiRef.current ? TOUCH_LANDMARK_DRAG_PX : LANDMARK_DRAG_PX;
      if (!drag.moved && dist < threshold) return;
      landmarkDragRef.current = {
        ...drag,
        lat: event.lngLat.lat,
        lng: event.lngLat.lng,
        moved: true,
      };
      map.getCanvas().style.cursor = "grabbing";
      hover.hide();
      map.triggerRepaint();
    };
    const finishLandmarkDrag = () => {
      if (geoDragRef.current) {
        geoDragRef.current = null;
        map.dragPan.enable();
        onGeoEditRef.current?.({ type: "move-end" });
        skipAnnotateClickRef.current = true;
      }
      const drag = landmarkDragRef.current;
      if (!drag) return;
      landmarkDragRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      if (drag.moved) {
        skipAnnotateClickRef.current = true;
        onMoveLandmarkRef.current?.({ name: drag.name, lat: drag.lat, lng: drag.lng });
        setHint(`Moved ${drag.name}`);
      } else if (touchUiRef.current) {
        const items = poisRef.current ?? [];
        const index = items.findIndex((poi) => poi.name === drag.name);
        setSelectedHit({
          kind: "poi",
          name: drag.name,
          label: index >= 0 ? `${index + 1} ${drag.name}` : drag.name,
        });
      }
      map.triggerRepaint();
    };
    const markStyleReady = () => {
      styleReadyRef.current = true;
      paint();
    };
    const onGeoContext = (event: { preventDefault: () => void; point: { x: number; y: number } }) => {
      if (!geoOutlineActiveRef.current || geoKindRef.current !== "polygon") return;
      event.preventDefault();
      const hit = hitOutlineVertex(map, event.point, geoOutlineRef.current ?? [], touchUiRef.current);
      if (hit != null) onGeoEditRef.current?.({ type: "remove", index: hit });
    };
    const onContextRestored = () => {
      resetCanvasLimit(map);
      paint();
    };
    map.on("load", markStyleReady);
    map.on("style.load", markStyleReady);
    map.on("webglcontextrestored", onContextRestored);
    map.on("render", redrawSchematic);
    map.on("click", onAnnotateClick);
    map.on("contextmenu", onGeoContext);
    map.on("mousedown", onLandmarkPointerDown);
    map.on("touchstart", onLandmarkPointerDown);
    map.on("mousemove", onLandmarkPointerMove);
    map.on("touchmove", onLandmarkPointerMove);
    map.on("mousemove", onHoverMove);
    map.on("mouseup", finishLandmarkDrag);
    map.on("touchend", finishLandmarkDrag);
    map.on("mouseout", onHoverLeave);
    window.addEventListener("pointerup", finishLandmarkDrag);
    return () => {
      map.off("load", markStyleReady);
      map.off("style.load", markStyleReady);
      map.off("webglcontextrestored", onContextRestored);
      map.off("render", redrawSchematic);
      map.off("click", onAnnotateClick);
      map.off("contextmenu", onGeoContext);
      map.off("mousedown", onLandmarkPointerDown);
      map.off("touchstart", onLandmarkPointerDown);
      map.off("mousemove", onLandmarkPointerMove);
      map.off("touchmove", onLandmarkPointerMove);
      map.off("mousemove", onHoverMove);
      map.off("mouseup", finishLandmarkDrag);
      map.off("touchend", finishLandmarkDrag);
      map.off("mouseout", onHoverLeave);
      window.removeEventListener("pointerup", finishLandmarkDrag);
      landmarkDragRef.current = null;
      map.dragPan.enable();
      clearMarkers(markersRef);
      hover.remove();
      if (hoverRef.current === hover) hoverRef.current = null;
      overlay.remove();
      if (overlayRef.current === overlay) overlayRef.current = null;
      styleReadyRef.current = false;
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === basemap) return;
    styleReadyRef.current = false;
    basemapRef.current = basemap;
    if (overlayRef.current) overlayRef.current.hidden = false;
    hoverRef.current?.setActive(basemap === "schematic" && !touchUiRef.current);
    if (landmarkDragRef.current) {
      landmarkDragRef.current = null;
      map.dragPan.enable();
    }
    map.setStyle(styleFor(basemap));
    if (basemap !== "schematic") {
      hoverRef.current?.hide();
    }
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const height = map.getContainer().clientHeight || 1;
    const bottom =
      fitPaddingBottom > 0
        ? Math.min(
            fitPaddingBottom + FIT_EDGE_PX + FIT_SHEET_GAP_PX,
            Math.floor(height * FIT_MAX_BOTTOM_RATIO),
          )
        : 0;
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    const apply = () => {
      resizeMap(map);
      const target = cropLatLng ?? selectedLatLng;
      if (basemapRef.current === "schematic") {
        clearMarkers(markersRef);
        map.triggerRepaint();
        fit(map, target, 600, bottom);
        return;
      }
      if (!styleReadyRef.current) return;
      map.triggerRepaint();
      fit(map, target, 600, bottom);
    };
    apply();
    return () => {
      map.off("style.load", apply);
    };
  }, [selectedLatLng, selectedRouteBreaks, cropLatLng, cropRouteBreaks, cropStops, viewNonce, fitPaddingBottom, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current === "schematic") {
      clearMarkers(markersRef);
      map.triggerRepaint();
      return;
    }
    const apply = () => {
      syncPoiMarkers(map, markersRef, pois, onRemovePoiRef, {
        draggable: labelingEnabled,
        onMoveLandmark: onMoveLandmarkRef,
        onMoved: (name) => setHint(`Moved ${name}`),
      });
      applyPoiMarkerHighlight(markersRef.current, highlightRef.current);
    };
    apply();
    if (!map.loaded()) map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [pois, labelingEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyPoiMarkerHighlight(markersRef.current, highlight);
    paintSchematicOverlay(map, overlayRef.current, {
      latlng: cropRef.current ?? trackRef.current,
      routeBreaks: cropRef.current ? cropBreaksRef.current : trackBreaksRef.current,
      stops: stopsRef.current,
      ways: waysRef.current,
      layers: layersRef.current,
      pois: poisWithDrag(poisRef.current, landmarkDragRef.current),
      namedWays: namedWaysRef.current,
      namedAreas: namedAreasRef.current,
      basemap: basemapRef.current,
      highlight,
      preview: annotatePreview(
        cropRef.current ?? trackRef.current,
        sectionStartRef.current,
        sectionHoverRef.current,
        draftRef.current,
      ),
      geoOutline: geoOutlineRef.current,
      geoOutlineActive: geoOutlineActiveRef.current,
      geoOutlinePreview: geoOutlinePreviewRef.current,
      geoOutlineSelected: geoSelectedRef.current,
      geoMask: geoMaskRef.current,
    });
  }, [highlight]);

  useEffect(() => {
    mapRef.current?.triggerRepaint();
    hoverRef.current?.hide();
  }, [ways, schematicLayers, pois, namedWays, namedAreas, geoOutline, geoOutlineActive, geoOutlinePreview, geoOutlineSelected, geoRectPending, geoMask]);

  useEffect(() => {
    setMode("browse");
    setToolsOpen(false);
    setDraft(null);
    setSelectedHit(null);
    setSectionStart(null);
    setSectionEditName("");
    setHint(null);
    sectionHoverRef.current = null;
    if (landmarkDragRef.current) {
      landmarkDragRef.current = null;
      mapRef.current?.dragPan.enable();
    }
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
    if (canvas) {
      canvas.style.cursor = geoOutlineActive || (mode !== "browse" && basemap === "schematic") ? "crosshair" : "";
    }
    mapRef.current?.triggerRepaint();
  }, [mode, basemap, draftAnchor, sectionStart, geoOutlineActive]);

  useEffect(() => {
    if (!draftAnchor) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [draftAnchor]);

  useEffect(() => {
    if (mode === "browse" && !draft && !selectedHit) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (selectedHit) {
        setSelectedHit(null);
        return;
      }
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
      setToolsOpen(false);
      setSectionEditName("");
      setHint(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, draft, sectionStart, selectedHit]);

  useEffect(() => {
    if (!editTrailExtent?.name) return;
    setMode("section");
    setToolsOpen(true);
    setDraft(null);
    setSelectedHit(null);
    setSectionEditName(editTrailExtent.name);
    setSectionStart(null);
    sectionHoverRef.current = null;
    onNeedSchematicRef.current?.();
    setHint(`Click the new start of “${editTrailExtent.name}”`);
    mapRef.current?.triggerRepaint();
  }, [editTrailExtent]);

  function toggleMode(next: AnnotateMode) {
    const chosen = mode === next ? "browse" : next;
    setMode(chosen);
    setDraft(null);
    setSelectedHit(null);
    setSectionStart(null);
    setSectionEditName("");
    sectionHoverRef.current = null;
    if (landmarkDragRef.current) {
      landmarkDragRef.current = null;
      mapRef.current?.dragPan.enable();
    }
    if (chosen === "browse") {
      setHint(null);
    } else {
      setToolsOpen(true);
      onNeedSchematicRef.current?.();
      setHint(chosen === "landmark" ? "Click the schematic to place a landmark" : "Click the start of the stretch");
    }
    mapRef.current?.triggerRepaint();
  }

  function toggleTools() {
    if (toolsOpen || mode !== "browse") {
      if (mode !== "browse") {
        setMode("browse");
        setDraft(null);
        setSelectedHit(null);
        setSectionStart(null);
        setSectionEditName("");
        sectionHoverRef.current = null;
        if (landmarkDragRef.current) {
          landmarkDragRef.current = null;
          mapRef.current?.dragPan.enable();
        }
        setHint(null);
        mapRef.current?.triggerRepaint();
      }
      setToolsOpen(false);
      return;
    }
    setToolsOpen(true);
  }

  const showAnnotateTools = toolsOpen || mode !== "browse";

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
      setHint(sectionEditName ? `Updated “${name}”` : "Click the start of another stretch");
    } else if (draft.target === "landmark") {
      const taken = (poisRef.current ?? []).map((poi) => poi.name);
      if (taken.some((item) => item !== draft.from && item.trim().toLowerCase() === name.toLowerCase())) {
        setHint(`“${name}” is already a landmark`);
        return;
      }
      onRenameLandmarkRef.current?.({ from: draft.from, name });
      setHint(`Renamed landmark to “${name}”`);
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
    setSectionEditName("");
    sectionHoverRef.current = null;
    mapRef.current?.triggerRepaint();
  }

  const showSchematicEmpty =
    basemap === "schematic" && !trackLoading && (!selectedLatLng || selectedLatLng.length < 2);

  return (
    <div className={`map-root${mode !== "browse" ? ` is-annotate-${mode}` : ""}${touchUi ? " is-touch" : ""}`}>
      <div ref={containerRef} className="map" />
      {trackLoading && (
        <div className="map-empty map-loading" role="status" aria-live="polite">
          <div className="map-empty-copy">
            <span className="spinner map-loading-spinner" aria-hidden="true" />
            <strong>Loading route</strong>
          </div>
        </div>
      )}
      {showSchematicEmpty && (
        <div className="map-empty" role="status">
          <div className="map-empty-copy">
            <strong>Select a route</strong>
            <p>Pick an activity to show its schematic.</p>
          </div>
        </div>
      )}
      {labelingEnabled && (
        <div className="map-annotate">
          <div
            className={`map-annotate-tools${showAnnotateTools ? " is-open" : ""}`}
            role="toolbar"
            aria-label="Schematic labels"
          >
            <button
              type="button"
              className={`map-annotate-toggle${showAnnotateTools ? " on" : ""}`}
              aria-expanded={showAnnotateTools}
              aria-label={showAnnotateTools ? "Hide label tools" : "Label tools"}
              title={showAnnotateTools ? "Hide label tools" : "Label tools"}
              onClick={toggleTools}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 3.5 5.5 7v5.2c0 4.2 2.8 8.1 6.5 9.3 3.7-1.2 6.5-5.1 6.5-9.3V7L12 3.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="11" r="2.2" fill="currentColor" />
              </svg>
            </button>
            {showAnnotateTools && (
              <>
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
              </>
            )}
          </div>
          {(hint || (mode !== "browse" && basemap !== "schematic")) && (
            <p className="map-annotate-hint">
              {basemap !== "schematic" && mode !== "browse"
                ? "Switching to the schematic…"
                : hint}
            </p>
          )}
          {selectedHit && !draft && touchUi && (
            <div className="map-schematic-select" role="toolbar" aria-label="Selected label">
              <strong>{selectedHit.label}</strong>
              {(selectedHit.kind === "trail" || selectedHit.kind === "poi") && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    const point = { x: 16, y: 16 };
                    if (selectedHit.kind === "poi") onRenameLandmarkStartRef.current(selectedHit.name, point);
                    else onRenameTrailStartRef.current(selectedHit.name, point);
                    setSelectedHit(null);
                  }}
                >
                  Rename
                </button>
              )}
              {selectedHit.kind === "trail" && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setMode("section");
                    setToolsOpen(true);
                    setSectionEditName(selectedHit.name);
                    setSectionStart(null);
                    sectionHoverRef.current = null;
                    setSelectedHit(null);
                    setHint(`Click the new start of “${selectedHit.name}”`);
                    mapRef.current?.triggerRepaint();
                  }}
                >
                  Edit extent
                </button>
              )}
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  if (selectedHit.kind === "area") onRemoveAreaRef.current?.(selectedHit.name);
                  else if (selectedHit.kind === "trail") onRemoveTrailRef.current?.(selectedHit.name);
                  else onRemovePoiRef.current?.(selectedHit.name);
                  setSelectedHit(null);
                }}
              >
                Remove
              </button>
              <button type="button" className="text-btn" onClick={() => setSelectedHit(null)}>
                Done
              </button>
            </div>
          )}
          {draft && (
            <form
              className="map-annotate-form"
              style={
                touchUi
                  ? undefined
                  : {
                      transform: `translate(${Math.max(8, draft.x)}px, ${Math.max(8, draft.y + 12)}px)`,
                    }
              }
              onSubmit={submitDraft}
            >
              <label className="map-annotate-label">
                {draft.kind === "landmark"
                  ? "Landmark name"
                  : draft.kind === "rename"
                    ? draft.target === "landmark"
                      ? "Rename landmark"
                      : "Rename stretch"
                    : "Stretch name"}
                <input
                  ref={nameInputRef}
                  className="search"
                  value={draft.name}
                  readOnly={draft.kind === "section" && Boolean(sectionEditName)}
                  placeholder={draft.kind === "landmark" ? "e.g. The old oak" : "e.g. Grandma's hill"}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <div className="map-annotate-actions">
                <button className="button" type="submit" disabled={!draft.name.trim()}>
                  {draft.kind === "rename" || (draft.kind === "section" && sectionEditName) ? "Save" : "Add"}
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
    trackBreaks: number[];
    crop: [number, number][] | null | undefined;
    cropBreaks: number[];
    stops: [number, number][] | undefined;
    pois: PosterPoi[] | undefined;
    namedWays: NamedWay[] | undefined;
    namedAreas: NamedArea[] | undefined;
    ways: PosterWays | null | undefined;
    layers: SchematicLayers | null | undefined;
    highlight?: LandmarkHighlight | null;
    onRemovePoi: { current?: (name: string) => void };
    onMoveLandmark?: { current?: (draft: LandmarkDraft) => void };
    labeling?: { current: boolean };
    onMovedLandmark?: (name: string) => void;
    geoMask?: GeoMask | null;
  },
) {
  if (basemap === "schematic") {
    clearMarkers(markersRef);
    paintSchematicOverlay(map, overlay, {
      latlng: data.crop ?? data.track,
      routeBreaks: data.crop ? data.cropBreaks : data.trackBreaks,
      stops: data.stops,
      ways: data.ways,
      layers: data.layers,
      pois: data.pois,
      namedWays: data.namedWays,
      namedAreas: data.namedAreas,
      basemap,
      highlight: data.highlight,
      geoMask: data.geoMask,
    });
    return;
  }
  paintSchematicOverlay(map, overlay, {
    latlng: data.crop ?? data.track,
    routeBreaks: data.crop ? data.cropBreaks : data.trackBreaks,
    stops: data.stops,
    ways: data.ways,
    layers: data.layers,
    pois: data.pois,
    namedWays: data.namedWays,
    namedAreas: data.namedAreas,
    basemap,
    highlight: data.highlight,
    geoMask: data.geoMask,
  });
  syncPoiMarkers(map, markersRef, data.pois, data.onRemovePoi, {
    draggable: Boolean(data.labeling?.current),
    onMoveLandmark: data.onMoveLandmark,
    onMoved: data.onMovedLandmark,
  });
  applyPoiMarkerHighlight(markersRef.current, data.highlight);
}

function paintSchematicOverlay(
  map: Map,
  canvas: HTMLCanvasElement | null,
  data: {
    latlng: [number, number][] | null | undefined;
    routeBreaks?: number[];
    stops?: [number, number][];
    ways: PosterWays | null | undefined;
    layers: SchematicLayers | null | undefined;
    pois: PosterPoi[] | undefined;
    namedWays: NamedWay[] | undefined;
    namedAreas: NamedArea[] | undefined;
    basemap: Basemap;
    highlight?: LandmarkHighlight | null;
    preview?: AnnotatePreview | null;
    geoOutline?: [number, number][];
    geoOutlineActive?: boolean;
    geoOutlinePreview?: boolean;
    geoOutlineSelected?: number | null;
    geoMask?: GeoMask | null;
  },
) {
  if (!canvas) return;
  canvas.hidden = false;
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
  if (data.basemap !== "schematic") {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (data.basemap === "satellite" && data.geoMask && maskIsActive(data.geoMask)) {
      veilOutsideMask(ctx, project, data.geoMask, data.latlng ?? [], canvas.width, canvas.height);
    }
    const scale = (sx + sy) / 2;
    paintStreetAnnotations(ctx, project, data.namedAreas, data.namedWays, scale);
    paintStreetTrack(
      ctx,
      data.latlng ?? [],
      data.routeBreaks ?? [],
      data.stops,
      project,
      scale,
      streetRouteMarkers(data.layers, data.latlng ?? []),
    );
    const outline = data.geoOutlineActive || data.geoOutlinePreview ? data.geoOutline : undefined;
    paintGeoOutline(ctx, outline, project, scale, {
      handles: Boolean(data.geoOutlineActive),
      selected: data.geoOutlineSelected,
    });
    paintChipHighlight(ctx, project, data, scale);
    return;
  }
  drawSchematicScene(
    ctx,
    {
      latlng: data.latlng ?? [],
      routeBreaks: data.routeBreaks,
      ways: data.ways ?? undefined,
      pois: data.pois,
      namedWays: data.namedWays,
      namedAreas: data.namedAreas,
      layers: data.layers ?? undefined,
      clipPolygon:
        data.geoMask?.whole
          ? undefined
          : (data.geoOutlineActive || data.geoOutlinePreview) && data.geoOutline && data.geoOutline.length >= 3
            ? data.geoOutline
            : undefined,
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
  const outline = data.geoOutlineActive || data.geoOutlinePreview ? data.geoOutline : undefined;
  paintGeoOutline(ctx, outline, project, lineScale, {
    handles: Boolean(data.geoOutlineActive),
    selected: data.geoOutlineSelected,
  });
  paintAnnotatePreview(ctx, project, data.preview, lineScale);
  paintChipHighlight(ctx, project, data, lineScale);
}

function paintGeoOutline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][] | undefined,
  project: (lng: number, lat: number) => [number, number],
  scale: number,
  options: { handles?: boolean; selected?: number | null } = {},
) {
  if (!points?.length) return;
  const handles = options.handles !== false;
  ctx.save();
  ctx.beginPath();
  points.forEach(([lng, lat], index) => {
    const [x, y] = project(lng, lat);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (points.length >= 3) ctx.closePath();
  ctx.strokeStyle = "#1d4e89";
  ctx.lineWidth = 2 * scale;
  ctx.setLineDash([6 * scale, 4 * scale]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (handles) {
    points.forEach(([lng, lat], index) => {
      const [x, y] = project(lng, lat);
      const selected = options.selected === index;
      ctx.beginPath();
      ctx.arc(x, y, (selected ? 7 : 4) * scale, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#ffffff" : "#1d4e89";
      ctx.fill();
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = "#1d4e89";
      ctx.stroke();
    });
  }
  ctx.restore();
}

function hitOutlineVertex(
  map: Map,
  point: { x: number; y: number },
  points: [number, number][],
  touch: boolean,
): number | null {
  const limit = (touch ? 22 : 12) ** 2;
  let best = limit;
  let index = -1;
  points.forEach(([lng, lat], item) => {
    const projected = map.project([lng, lat]);
    const dist = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
    if (dist <= best) {
      best = dist;
      index = item;
    }
  });
  return index >= 0 ? index : null;
}

function streetRouteMarkers(
  layers: SchematicLayers | null | undefined,
  latlng: [number, number][],
): false | "ends" | "loop" {
  if (latlng.length < 2) return false;
  const setting = layers?.routeMarkers;
  if (setting === false) return false;
  if (setting) return setting;
  return isClosedLoop(latlng) ? "loop" : "ends";
}

function paintStreetTrack(
  ctx: CanvasRenderingContext2D,
  latlng: [number, number][],
  breaks: number[],
  stops: [number, number][] | undefined,
  project: (lng: number, lat: number) => [number, number],
  scale: number,
  markers: false | "ends" | "loop" = "ends",
) {
  if (latlng.length < 2) return;
  const points = latlng.map(([lat, lng]) => project(lng, lat));
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  const starts = new Set(breaks);
  for (let i = 1; i < points.length; i += 1) {
    if (starts.has(i)) ctx.moveTo(points[i][0], points[i][1]);
    else ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 8 * scale;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = 4.5 * scale;
  ctx.globalAlpha = 1;
  ctx.stroke();
  for (const [lat, lng] of stops ?? []) {
    const [x, y] = project(lng, lat);
    ctx.beginPath();
    ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#e8c36a";
    ctx.fill();
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = "#111111";
    ctx.stroke();
  }
  if (markers) paintRouteEndMarkers(ctx, points[0], points[points.length - 1], markers, scale);
  ctx.restore();
}

/** White disc behind the schematic start/finish dots so they read on imagery and the route casing. */
function paintRouteEndMarkers(
  ctx: CanvasRenderingContext2D,
  start: [number, number],
  end: [number, number],
  mode: "ends" | "loop",
  scale: number,
) {
  const halo = (mode === "loop" ? 14 : 11) * scale;
  ctx.beginPath();
  ctx.arc(start[0], start[1], halo, 0, Math.PI * 2);
  if (mode === "ends") {
    ctx.moveTo(end[0] + halo, end[1]);
    ctx.arc(end[0], end[1], halo, 0, Math.PI * 2);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  drawRouteEndMarkers(ctx, start, end, mode, scale);
}

function paintStreetAnnotations(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  areas: NamedArea[] | undefined,
  trails: NamedWay[] | undefined,
  scale: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(196, 148, 88, 0.28)";
  for (const area of areas ?? []) fillProjectedGeometry(ctx, area.geometry, project);
  ctx.setLineDash([2 * scale, 1 * scale]);
  ctx.strokeStyle = "rgba(150, 96, 48, 0.85)";
  ctx.lineWidth = 1.5 * scale;
  ctx.lineJoin = "round";
  for (const area of areas ?? []) fillProjectedGeometry(ctx, area.geometry, project, true);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(194, 65, 12, 0.85)";
  ctx.lineWidth = 3 * scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const trail of trails ?? []) {
    for (const line of trail.geometry.coordinates) {
      if (line.length < 2) continue;
      ctx.beginPath();
      line.forEach((point, index) => {
        const [x, y] = project(point[0], point[1]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
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
  touch = false,
): { index: number; distPx: number } | null {
  if (!route?.length) return null;
  const snap = touch ? TOUCH_ROUTE_SNAP_PX : ROUTE_SNAP_PX;
  let bestIndex = 0;
  let bestDist = Infinity;
  if (route.length === 1) {
    const projected = map.project([route[0][1], route[0][0]]);
    const dist = Math.hypot(projected.x - point.x, projected.y - point.y);
    return dist <= snap ? { index: 0, distPx: dist } : null;
  }
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = map.project([route[i][1], route[i][0]]);
    const to = map.project([route[i + 1][1], route[i + 1][0]]);
    const { dist, t } = distToSegmentPxT(point, from, to);
    if (dist >= bestDist) continue;
    bestDist = dist;
    bestIndex = t < 0.5 ? i : i + 1;
  }
  if (bestDist > snap) return null;
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
  onRenameLandmarkStartRef: { current?: (name: string, point: { x: number; y: number }) => void },
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
    const editable = hit.kind === "trail" || hit.kind === "poi";
    name.hidden = editable;
    rename.hidden = !editable;
    if (editable) {
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
    if (current?.kind === "poi") onRenameLandmarkStartRef.current?.(current.name, lastPoint);
    else if (current?.kind === "trail") onRenameTrailStartRef.current?.(current.name, lastPoint);
    else return;
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

function poisWithDrag(pois: PosterPoi[] | undefined, drag: LandmarkDrag | null): PosterPoi[] | undefined {
  if (!drag || !pois) return pois;
  return pois.map((poi) => (poi.name === drag.name ? { ...poi, lat: drag.lat, lng: drag.lng } : poi));
}

function hitTestPoi(
  map: Map,
  point: { x: number; y: number },
  pois: PosterPoi[] | undefined,
  touch = false,
): PosterPoi | null {
  const items = Array.isArray(pois) ? pois : [];
  let best: PosterPoi | null = null;
  let bestDist = touch ? TOUCH_POI_HIT_PX : POI_HIT_PX;
  for (const poi of items) {
    const projected = map.project([poi.lng, poi.lat]);
    const dist = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (dist > bestDist) continue;
    best = poi;
    bestDist = dist;
  }
  return best;
}

function hitTestSchematic(
  map: Map,
  point: { x: number; y: number },
  lngLat: { lng: number; lat: number },
  pois: PosterPoi[] | undefined,
  trails: NamedWay[] | undefined,
  areas: NamedArea[] | undefined,
  route: [number, number][] | null | undefined,
  touch = false,
): SchematicHover | null {
  const items = Array.isArray(pois) ? pois : [];
  const poi = hitTestPoi(map, point, items, touch);
  if (poi) {
    return { kind: "poi", name: poi.name, label: `${items.indexOf(poi) + 1} ${poi.name}` };
  }
  const trail = hitTestTrail(map, point, lngLat, trails, route, touch);
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
  touch = false,
): SchematicHover | null {
  const items = Array.isArray(trails) ? trails : [];
  if (!items.length) return null;
  const trailHit = touch ? TOUCH_TRAIL_HIT_PX : TRAIL_HIT_PX;
  let bestOrder = items.length;
  for (let index = 0; index < items.length; index += 1) {
    if (distToWayPx(map, point, items[index].geometry.coordinates) > trailHit) continue;
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
    if (Math.hypot(projected.x - point.x, projected.y - point.y) <= trailHit) {
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

function applyPoiMarkerHighlight(markers: Marker[], highlight?: LandmarkHighlight | null) {
  const name = highlight?.kind === "poi" ? highlight.name : null;
  for (const marker of markers) {
    const root = marker.getElement();
    root.classList.toggle("is-highlight", Boolean(name && root.dataset.name === name));
  }
}

function paintChipHighlight(
  ctx: CanvasRenderingContext2D,
  project: (lng: number, lat: number) => [number, number],
  data: {
    pois?: PosterPoi[];
    namedWays?: NamedWay[];
    namedAreas?: NamedArea[];
    highlight?: LandmarkHighlight | null;
  },
  scale: number,
) {
  const highlight = data.highlight;
  if (!highlight) return;
  ctx.save();
  if (highlight.kind === "area") {
    const area = data.namedAreas?.find((item) => item.name === highlight.name);
    if (area) {
      ctx.fillStyle = "rgba(240, 195, 106, 0.45)";
      fillProjectedGeometry(ctx, area.geometry, project);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#c98920";
      ctx.lineWidth = 3 * scale;
      fillProjectedGeometry(ctx, area.geometry, project, true);
    }
  } else if (highlight.kind === "trail") {
    const trail = data.namedWays?.find((item) => item.name === highlight.name);
    if (trail) {
      ctx.strokeStyle = trail.color || "#fb923c";
      ctx.lineWidth = 6 * scale;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const line of trail.geometry.coordinates) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach((point, index) => {
          const [x, y] = project(point[0], point[1]);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  } else {
    const poi = data.pois?.find((item) => item.name === highlight.name);
    if (poi) {
      const [x, y] = project(poi.lng, poi.lat);
      ctx.beginPath();
      ctx.arc(x, y, 8 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(244, 208, 120, 0.35)";
      ctx.fill();
      ctx.lineWidth = 2.5 * scale;
      ctx.strokeStyle = "#f4d078";
      ctx.stroke();
    }
  }
  ctx.restore();
}

function fillProjectedGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: NamedArea["geometry"],
  project: (lng: number, lat: number) => [number, number],
  stroke = false,
) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    ctx.beginPath();
    for (const ring of polygon) {
      ring.forEach((point, index) => {
        const [x, y] = project(point[0], point[1]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    if (stroke) ctx.stroke();
    else ctx.fill();
  }
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
  options?: {
    draggable?: boolean;
    onMoveLandmark?: { current?: (draft: LandmarkDraft) => void };
    onMoved?: (name: string) => void;
  },
) {
  clearMarkers(markersRef);
  const items = Array.isArray(pois) ? pois : [];
  markersRef.current = items.map((poi, index) => {
    const root = document.createElement("div");
    root.className = options?.draggable ? "map-poi is-draggable" : "map-poi";
    root.dataset.name = poi.name;
    const dot = document.createElement("span");
    dot.className = "map-poi-dot";
    if (options?.draggable) {
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", `Move ${poi.name}`);
    }
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
    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemovePoiRef.current?.(poi.name);
    });
    remove.textContent = "×";
    label.append(name, remove);
    root.append(dot, label);
    const marker = new Marker({ element: root, anchor: "top" }).setLngLat([poi.lng, poi.lat]).addTo(map);
    if (options?.draggable) {
      bindMarkerDrag(map, marker, root, poi.name, options);
    } else {
      root.addEventListener("click", () => {
        for (const el of map.getContainer().querySelectorAll(".map-poi.is-selected")) {
          if (el !== root) el.classList.remove("is-selected");
        }
        root.classList.toggle("is-selected");
      });
    }
    return marker;
  });
}

function bindMarkerDrag(
  map: Map,
  marker: Marker,
  root: HTMLElement,
  name: string,
  options: {
    onMoveLandmark?: { current?: (draft: LandmarkDraft) => void };
    onMoved?: (name: string) => void;
  },
) {
  let startX = 0;
  let startY = 0;
  let moved = false;
  const pointFrom = (event: PointerEvent) => {
    const rect = map.getCanvas().getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onMove = (event: PointerEvent) => {
    const dist = Math.hypot(event.clientX - startX, event.clientY - startY);
    const threshold = window.matchMedia("(pointer: coarse)").matches
      ? TOUCH_LANDMARK_DRAG_PX
      : LANDMARK_DRAG_PX;
    if (!moved && dist < threshold) return;
    moved = true;
    root.classList.add("is-dragging");
    const point = pointFrom(event);
    marker.setLngLat(map.unproject([point.x, point.y]));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    map.dragPan.enable();
    root.classList.remove("is-dragging");
    if (!moved) {
      for (const el of map.getContainer().querySelectorAll(".map-poi.is-selected")) {
        if (el !== root) el.classList.remove("is-selected");
      }
      root.classList.toggle("is-selected");
      return;
    }
    const { lat, lng } = marker.getLngLat();
    options.onMoveLandmark?.current?.({ name, lat, lng });
    options.onMoved?.(name);
  };
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".map-poi-remove")) return;
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    startY = event.clientY;
    moved = false;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    map.dragPan.disable();
  };
  root.addEventListener("pointerdown", onDown);
  for (const handle of root.querySelectorAll(".map-poi-dot, .map-poi-name")) {
    handle.addEventListener("pointerdown", onDown as EventListener);
  }
}

type CanvasLimitedMap = Map & { _maxCanvasSize: [number, number] };

function resetCanvasLimit(map: Map) {
  (map as CanvasLimitedMap)._maxCanvasSize = DEFAULT_MAX_CANVAS;
}

/** Resize, and undo a MapLibre canvas cap left behind by a lost WebGL context. */
function resizeMap(map: Map) {
  const collapsed = () => {
    const canvas = map.getCanvas();
    const box = map.getContainer();
    return canvasBitmapCollapsed(box.clientWidth, box.clientHeight, canvas.width, canvas.height);
  };
  if (collapsed()) resetCanvasLimit(map);
  map.resize();
  if (!collapsed()) return;
  resetCanvasLimit(map);
  map.resize();
}

const FIT_EDGE_PX = 72;
/** Extra space above the sheet beyond the edge inset (line width + sheet shadow). */
const FIT_SHEET_GAP_PX = 8;
/** Soft floor: never let sheet inset eat more than this fraction of the map. */
const FIT_MAX_BOTTOM_RATIO = 0.72;

function fit(
  map: Map,
  latlng: [number, number][] | null | undefined,
  duration: number,
  bottomPadPx = 0,
) {
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
  const height = map.getContainer().clientHeight || 1;
  const width = map.getContainer().clientWidth || 1;
  const edge = Math.min(FIT_EDGE_PX, Math.floor(Math.min(width, height) / 8));
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    {
      padding: {
        top: edge,
        right: edge,
        left: edge,
        bottom: Math.max(edge, bottomPadPx),
      },
      maxZoom: 14,
      duration,
    },
  );
}
