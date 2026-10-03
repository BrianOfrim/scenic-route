import type { GeographyScene } from "../../../api/src/osm/geographyPolicy";
import { GEOGRAPHY_BUCKETS, GEOGRAPHY_VERSION, automaticGeographyAllowance, visibleGeographyIds } from "../../../api/src/osm/geographyPolicy";
import { beginGeneration } from "../gallery/generationState";
import { ThemeExamples } from "./ThemeExamples";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  fetchPosterCapabilities,
  fetchPosterContext,
  fetchPosterLocation,
  fetchPosterGeography,
  formatKm,
  lookupPosterLandmark,
  submitPosterBatch,
  uploadPosterReferences,
  type FormattedStat,
  type ImageModelOption,
  type NamedArea,
  type NamedWay,
  type PosterContext,
  type PosterPoi,
  type PosterRecord,
  type PosterSpec,
  type PosterWays,
} from "../api";
import { defaultCorridorM, formatCorridorM } from "../../../api/src/osm/corridor";
import {
  clipWaysSoftThenHard,
  convexHullRing,
  endRadiusM,
  loopBandRing,
  outerExpandM,
  rectangleRing,
  rectangleTooSmall,
  rotatedBoxRing,
  shapePadM,
  type LngLat,
} from "../../../api/src/osm/geoExtent";
import {
  appendOutlinePoint,
  commitOutline,
  emptyOutline,
  liveOutline,
  pointsChanged,
  redoOutline,
  removeOutlinePoint,
  undoOutline,
  type GeoEdit,
  type OutlineHistory,
} from "./polygonEdit";

type GeoScope = "all" | "corridor" | "ends" | "box" | "hull" | "loop" | "rectangle" | "polygon";

function formatDataSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const GEO_SCOPES: { id: GeoScope; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Full map area." },
  { id: "corridor", label: "Corridor", hint: "A band around the route." },
  { id: "ends", label: "Wider ends", hint: "A narrow band with more space at the start and finish." },
  { id: "box", label: "Rotated box", hint: "A rectangle aligned with the route." },
  { id: "hull", label: "Convex hull", hint: "A padded outline around the route." },
  { id: "loop", label: "Inside loop", hint: "Inside a closed route, with a small outer margin." },
  { id: "rectangle", label: "Rectangle", hint: "Click two corners on the map. Drag a corner to resize." },
  { id: "polygon", label: "Polygon", hint: "Click to add corners, drag to move, right-click to remove." },
];

import { clampCrop, isClosedLoop, isNearCroppedRoute, paddedBbox, schematicBbox, shiftRouteSpans, sliceTrack, sliceTrackBreaks, snapIndex, snapRadius, trackDistanceM } from "./crop";
import {
  FEATURE_CATALOG,
  DEFAULT_FEATURE_IDS,
  MAX_NEAR_ROUTE_M,
  clampNearRouteM,
  defaultLandmarkNearM,
  contextFeatureQuery,
  nearRouteMForKind,
  type FeatureOption,
} from "./featureCatalog";
import { renderContactSheets, type GroundingLayer } from "./grounding/contactSheet";
import { createReferenceUploadCache } from "./referenceUploadCache";
import { selectReferenceLayers } from "./grounding/referenceLayers";
import {
  DEFAULT_ASPECT_RATIO,
  renderSchematicDataUrl,
  schematicLayersFromFeatureIds,
} from "./grounding/renderSchematic";
import { maskIsActive, type GeoMask } from "./grounding/geoMask";
import { satelliteReferenceMask } from "./grounding/satelliteMask";
import { renderMaskedSatellite, snapshotTiles, type SatelliteFrame } from "./grounding/snapshotTiles";
import {
  applyTrailAlias,
  nextTrailAliases,
  relocateLandmark,
  renamedLandmark,
  resizedNamedWay,
  trailSourceName,
  userLandmark,
  userNamedWay,
} from "./annotate";
import {
  captureEditorSnapshot,
  editorSeed,
  restoreEditor,
  styleIdFromRecord,
} from "./editorSnapshot";
import { formatPeople, parsePeople, PEOPLE_INPUT_MAX } from "./people";
import { applyStatUnits, DEFAULT_STAT_IDS, distanceToMeters, formatDistance, type StatUnits } from "./statUnits";
import { addedFeatureIds, forgetDismissedForLayers, takeFreshNames } from "./autoNames";
import { MAX_LABELS, prioritizeLabels } from "./labels";
import { cropCoordinates, nearestPlaceName } from "./places";
import { assignAreaLetters } from "./areaLetters";
import { assignTrailColors } from "./trailColors";
import {
  minMaxReferences,
  uiImageModelFromCapabilities,
  variantCount,
} from "./imageModels";

import {
  AUTO_PALETTE_ID,
  DEFAULT_POSTER_STYLE,
  THEME_GROUPS,
  defaultPaletteId,
  normalizePaletteId,
  paletteChoices,
  paletteIdsForStyle,
  parsePlanSlotKey,
  planSlotKey,
  planSlotLabel,
  resolveStyleColor,
  showsPalettePicker,
  specForSlot,
  styleById,
  stylePlanSlots,
} from "./styles";




const DEFAULT_VARIANTS = 1;
const EMPTY_POIS: PosterPoi[] = [];
const EMPTY_WAYS: NamedWay[] = [];
const EMPTY_AREAS: NamedArea[] = [];

const SCHEMATIC_LEGEND =
  "red = unnamed GPS track; colored route stretches = named trails, private color index, do not copy onto the poster; grey = roads; blue = water; green = forest; teal = wetlands; pale green = open vegetation; sand = beaches; grey-brown fill = rock; pale blue = glaciers; blue shoreline = coastline; brown lines = cliffs; ochre wash + letter = named district, private region index, copy the footprint not the ochre or letter; numbered discs = private location index, do not copy";

const GEOGRAPHY_LEGEND = "red = GPS track; grey = roads; blue = water; green = forest/parks; teal = wetlands; pale green = open vegetation; sand = beaches; grey-brown fill = rock; pale blue = glaciers; blue shoreline = coastline; brown lines = cliffs";

const ROUTE_ONLY_LEGEND = "red = GPS track";

const SATELLITE_LEGEND =
  "real aerial imagery of the same frame; red = GPS track; use for land cover, water, vegetation, and built form; every red stroke is a required segment; do not copy the photograph";

const SATELLITE_MASK_LEGEND = `${SATELLITE_LEGEND}; black margin is empty, not land, water, or sky`;

/** Wait until the crop sliders settle before opening another WebGL map. */
const SATELLITE_SNAPSHOT_DELAY_MS = 300;


function chipHighlight(
  kind: "area" | "trail" | "poi",
  name: string,
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void,
) {
  return {
    onMouseEnter: () => onHighlightChange?.({ kind, name }),
    onMouseLeave: () => onHighlightChange?.(null),
    onFocus: () => onHighlightChange?.({ kind, name }),
    onBlur: () => onHighlightChange?.(null),
  };
}

function LandmarkChip({
  kind,
  name,
  label,
  title,
  selected,
  touchUi,
  editing = false,
  draft = name,
  onSelect,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onRemove,
  onHighlightChange,
}: {
  kind: "area" | "poi";
  name: string;
  label: string;
  title: string;
  selected: boolean;
  touchUi: boolean;
  editing?: boolean;
  draft?: string;
  onSelect: () => void;
  onEdit?: () => void;
  onDraft?: (value: string) => void;
  onSave?: (value: string) => void;
  onCancel?: () => void;
  onRemove: () => void;
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurRef = useRef(false);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);
  if (onEdit) {
    return (
      <span
        className={`chip on${selected ? " is-selected" : ""}`}
        title={editing ? undefined : `${title}. Click the name to rename.`}
        {...chipHighlight(kind, name, onHighlightChange)}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="chip-edit"
            value={draft}
            aria-label={`Rename ${name}`}
            onChange={(event) => onDraft?.(event.target.value)}
            onBlur={() => {
              if (skipBlurRef.current) {
                skipBlurRef.current = false;
                return;
              }
              onSave?.(inputRef.current?.value ?? draft);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSave?.(event.currentTarget.value);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                skipBlurRef.current = true;
                onCancel?.();
              }
            }}
          />
        ) : (
          <button type="button" className="chip-name" onClick={onEdit}>
            {label}
          </button>
        )}
        <button
          type="button"
          className="chip-remove"
          aria-label={`Remove ${name}`}
          title={`Remove ${name}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
        >
          ×
        </button>
      </span>
    );
  }
  if (!touchUi) {
    return (
      <button
        type="button"
        className="chip on"
        title={title}
        onClick={onRemove}
        {...chipHighlight(kind, name, onHighlightChange)}
      >
        {label} ×
      </button>
    );
  }
  return (
    <span
      className={`chip on${selected ? " is-selected" : ""}`}
      title={title}
      {...chipHighlight(kind, name, onHighlightChange)}
    >
      <button type="button" className="chip-name" onClick={onSelect}>
        {label}
      </button>
      <button
        type="button"
        className="chip-remove"
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

function TrailChip({
  trail,
  editing,
  draft,
  selected,
  touchUi,
  onSelect,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onEditExtent,
  onRemove,
  onHighlightChange,
}: {
  trail: NamedWay;
  editing: boolean;
  draft: string;
  selected?: boolean;
  touchUi?: boolean;
  onSelect?: () => void;
  onEdit: () => void;
  onDraft: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  onEditExtent: () => void;
  onRemove: () => void;
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurRef = useRef(false);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);
  const title =
    trail.source === "user" ? "Named by hand on the schematic" : "Named trail on the schematic";
  return (
    <span
      className={`chip on${selected ? " is-selected" : ""}`}
      title={editing ? undefined : `${title}. Click the name to rename.`}
      onClick={touchUi ? onSelect : undefined}
      {...chipHighlight("trail", trail.name, onHighlightChange)}
    >
      <span className="chip-swatch" style={{ background: trail.color }} aria-hidden />
      {editing ? (
        <input
          ref={inputRef}
          className="chip-edit"
          value={draft}
          aria-label={`Rename ${trail.name}`}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            onSave(inputRef.current?.value ?? draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSave((event.target as HTMLInputElement).value);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              skipBlurRef.current = true;
              onCancel();
            }
          }}
        />
      ) : (
        <button type="button" className="chip-name" onClick={onEdit}>
          {trail.name}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          className="chip-extent"
          aria-label={`Edit start and end of ${trail.name}`}
          title={`Edit start and end of ${trail.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onEditExtent();
          }}
        >
          ↔
        </button>
      )}
      <button
        type="button"
        className="chip-remove"
        aria-label={`Remove ${trail.name}`}
        title={`Remove ${trail.name}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </span>
  );
}

function routeMarkerMode(show: boolean, latlng: [number, number][]): false | "ends" | "loop" {
  if (!show) return false;
  return isClosedLoop(latlng) ? "loop" : "ends";
}

function schematicLegend(
  markers: false | "ends" | "loop",
  annotations = true,
  hasGeography = false,
) {
  const base = annotations ? SCHEMATIC_LEGEND : hasGeography ? GEOGRAPHY_LEGEND : ROUTE_ONLY_LEGEND;
  if (markers === "loop") return `${base}; gold/green = combined start/finish`;
  if (markers === "ends") return `${base}; green/black dots = start/finish`;
  return base;
}

function groundingLayers(
  schematicUrl: string | null,
  routeReferenceUrl: string | null,
  satelliteUrl: string | null,
  maxRefs: number,
  latlng: [number, number][],
  showMarkers: boolean,
  annotations = true,
  hasGeography = false,
  satelliteMasked = false,
): GroundingLayer[] {
  if (!schematicUrl) return [];
  const markers = routeMarkerMode(showMarkers, latlng);
  return selectReferenceLayers(
    {
      role: "schematic",
      legend: schematicLegend(markers, annotations, hasGeography),
      dataUrl: schematicUrl,
    },
    routeReferenceUrl ? {
      role: "route-only",
      legend: `${schematicLegend(markers, false)}; white background; exact GPS geometry, gaps and endpoints; identical frame and scale to the schematic`,
      dataUrl: routeReferenceUrl,
    } : null,
    satelliteUrl ? {
      role: "satellite",
      legend: satelliteMasked ? SATELLITE_MASK_LEGEND : SATELLITE_LEGEND,
      dataUrl: satelliteUrl,
    } : null,
    maxRefs,
  );
}

function seedDismissed(incoming: string[], selected: string[], dismissed: Set<string>) {
  dismissed.clear();
  const keep = new Set(selected);
  for (const name of incoming) {
    if (!keep.has(name)) dismissed.add(name);
  }
}

function FeatureQueryHint({ label }: { label: string }) {
  return (
    <span className="feature-query" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

function CropRangeSlider({
  start,
  end,
  max,
  stops,
  onChange,
}: {
  start: number;
  end: number;
  max: number;
  stops: number[];
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"start" | "end" | null>(null);

  const startPct = max > 0 ? (start / max) * 100 : 0;
  const endPct = max > 0 ? (end / max) * 100 : 100;

  function valueFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track || max <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return Math.round(ratio * max);
  }

  function moveHandle(handle: "start" | "end", raw: number) {
    if (handle === "start") onChange(Math.max(0, Math.min(raw, end - 1)), end);
    else onChange(start, Math.min(max, Math.max(raw, start + 1)));
  }

  function beginDrag(handle: "start" | "end", event: ReactPointerEvent<HTMLElement>, moveNow = false) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (moveNow) moveHandle(handle, valueFromClientX(event.clientX));
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    moveHandle(dragRef.current, valueFromClientX(event.clientX));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onTrackPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".poster-crop-range-thumb")) return;
    const raw = valueFromClientX(event.clientX);
    const handle = Math.abs(raw - start) <= Math.abs(raw - end) ? "start" : "end";
    beginDrag(handle, event, true);
  }

  function onThumbKeyDown(handle: "start" | "end", event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? Math.max(1, Math.round(max / 20)) : 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = (handle === "start" ? start : end) - step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = (handle === "start" ? start : end) + step;
    else if (event.key === "Home") next = handle === "start" ? 0 : start + 1;
    else if (event.key === "End") next = handle === "start" ? end - 1 : max;
    if (next == null) return;
    event.preventDefault();
    moveHandle(handle, next);
  }

  return (
    <div
      className="poster-crop-range"
      ref={trackRef}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="poster-crop-range-track" aria-hidden="true">
        <div className="poster-crop-range-fill" style={{ left: `${startPct}%`, right: `${100 - endPct}%` }} />
        {stops.map((index) => (
          <span
            key={index}
            className="poster-crop-range-stop"
            style={{ left: `${max > 0 ? (index / max) * 100 : 0}%` }}
          />
        ))}
      </div>
      <button
        type="button"
        className="poster-crop-range-thumb is-start"
        style={{ left: `${startPct}%` }}
        aria-label="Crop start"
        aria-valuemin={0}
        aria-valuemax={end - 1}
        aria-valuenow={start}
        role="slider"
        onPointerDown={(event) => beginDrag("start", event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onThumbKeyDown("start", event)}
      />
      <button
        type="button"
        className="poster-crop-range-thumb is-end"
        style={{ left: `${endPct}%` }}
        aria-label="Crop end"
        aria-valuemin={start + 1}
        aria-valuemax={max}
        aria-valuenow={end}
        role="slider"
        onPointerDown={(event) => beginDrag("end", event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onThumbKeyDown("end", event)}
      />
    </div>
  );
}

function SectionTitle({ title, beta }: { title: string; beta?: boolean }) {
  return (
    <>
      {title}
      {beta ? <span className="beta-mark">Beta</span> : null}
    </>
  );
}

function PosterSection({
  title,
  accordion,
  children,
  className = "",
  hint,
  open,
  busy,
  showTitle = true,
  beta = false,
}: {
  title: string;
  accordion: boolean;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
  open?: boolean;
  busy?: boolean;
  showTitle?: boolean;
  beta?: boolean;
}) {
  const [expanded, setExpanded] = useState(Boolean(open));
  if (accordion) {
    return (
      <div className={`panel-block ${className}`.trim()} aria-busy={busy || undefined}>
        <details
          className="poster-section-details"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <span className="eyebrow">
              <SectionTitle title={title} beta={beta} />
            </span>
            {hint}
          </summary>
          {children}
        </details>
      </div>
    );
  }
  return (
    <div className={`panel-block ${className}`.trim()} aria-busy={busy || undefined}>
      {showTitle ? (
        hint ? (
          <div className="eyebrow-row">
            <div className="eyebrow">
              <SectionTitle title={title} beta={beta} />
            </div>
            {hint}
          </div>
        ) : (
          <div className="eyebrow">
            <SectionTitle title={title} beta={beta} />
          </div>
        )
      ) : (
        hint
      )}
      {children}
    </div>
  );
}

type ModelRef = { role: string; legend?: string; dataUrl: string };

export type PosterSheetSnap = "peek" | "half" | "full";

const SHEET_ORDER: PosterSheetSnap[] = ["peek", "half", "full"];

type PosterWorkflowStep =
  | "crop"
  | "geography"
  | "on-map"
  | "annotations"
  | "themes"
  | "stats"
  | "output";

/** Mobile sheet: one-tap launch vs full Customize editor. Desktop ignores this. */
type MobileSurface = "launch" | "customize";

const MAP_WORKFLOW_STEPS = new Set<PosterWorkflowStep>(["crop", "on-map"]);

type Props = {
  activityId: number;
  defaultPeople?: string;
  activityLabel?: string;
  features: FeatureOption[];
  onClose: () => void;
  onCropChange?: (crop: [number, number][] | null) => void;
  onBreaksChange?: (breaks: number[]) => void;
  onStopsChange?: (stops: [number, number][]) => void;
  onPoisChange?: (pois: PosterPoi[]) => void;
  onNamedWaysChange?: (trails: NamedWay[]) => void;
  onNamedAreasChange?: (areas: NamedArea[]) => void;
  onWaysChange?: (ways: PosterWays | null) => void;
  onSchematicLayersChange?: (layers: ReturnType<typeof schematicLayersFromFeatureIds> | null) => void;
  onNeedSchematic?: () => void;
  onGeoMaskChange?: (mask: GeoMask | null) => void;
  onGeoOutlineChange?: (outline: {
    active: boolean;
    preview: boolean;
    kind: "polygon" | "rectangle";
    points: [number, number][];
    selected: number | null;
    rectPending: boolean;
  }) => void;
  onBindGeoEdit?: (handler: (edit: GeoEdit) => void) => void;
  onRouteOnlyChange?: (routeOnly: boolean) => void;
  refineFrom?: PosterRecord | null;
  dismissPoi?: { name: string; nonce: number } | null;
  dismissArea?: { name: string; nonce: number } | null;
  dismissTrail?: { name: string; nonce: number } | null;
  placeLandmark?: { name: string; lat: number; lng: number; nonce: number } | null;
  moveLandmark?: { name: string; lat: number; lng: number; nonce: number } | null;
  placeSection?: { name: string; start: number; end: number; nonce: number } | null;
  onEditTrailExtent?: (name: string) => void;
  renameTrail?: { name: string; next: string; nonce: number } | null;
  renameLandmark?: { name: string; next: string; nonce: number } | null;
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void;
  /** Fires once background requests and their gallery placeholders are registered. */
  onGenerationStarted?: () => void;
  touchUi?: boolean;
  sheetSnap?: PosterSheetSnap | null;
  onSheetSnapChange?: (snap: PosterSheetSnap) => void;
  onSheetHeightChange?: (heightPx: number) => void;
};

export function PosterPanel({
  activityId,
  defaultPeople = "",
  activityLabel,
  features,
  onClose,
  onCropChange,
  onBreaksChange,
  onStopsChange,
  onPoisChange,
  onNamedWaysChange,
  onNamedAreasChange,
  onWaysChange,
  onSchematicLayersChange,
  onNeedSchematic,
  onGeoOutlineChange,
  onGeoMaskChange,
  onBindGeoEdit,
  onRouteOnlyChange,
  refineFrom,
  dismissPoi,
  dismissArea,
  dismissTrail,
  placeLandmark,
  moveLandmark,
  placeSection,
  onEditTrailExtent,
  renameTrail: renameTrailEvent,
  renameLandmark: renameLandmarkEvent,
  onHighlightChange,
  onGenerationStarted,
  touchUi = false,
  sheetSnap = null,
  onSheetSnapChange,
  onSheetHeightChange,
}: Props) {
  const catalog = FEATURE_CATALOG.map((item) => {
    const remote = features.find((feature) => feature.id === item.id);
    if (!remote) return item;
    return { ...item, ...remote, nearRouteM: remote.nearRouteM ?? item.nearRouteM };
  });
  const seeded = useMemo(() => editorSeed(refineFrom), [refineFrom]);
  const [selectedChip, setSelectedChip] = useState<{ kind: "area" | "trail" | "poi"; name: string } | null>(null);
  const [context, setContext] = useState<PosterContext | null>(null);
  const [corridorOverride, setCorridorOverride] = useState<number | null>(null);
  const [geoScope, setGeoScope] = useState<GeoScope>("all");
  const [polygon, setPolygon] = useState<OutlineHistory>(emptyOutline);
  const [rectangle, setRectangle] = useState<OutlineHistory>(emptyOutline);
  const [rectAnchor, setRectAnchor] = useState<LngLat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geographyMode, setGeographyMode] = useState<"auto" | "manual">(() => seeded?.geographyMode ?? "auto");
  const [geographyResult, setGeographyResult] = useState<{ key: string; scene: GeographyScene } | null>(null);
  const [geographyError, setGeographyError] = useState<string | null>(null);
  const [geographyRetry, setGeographyRetry] = useState(0);
  const [featureIds, setFeatureIds] = useState<string[]>(() => seeded?.featureIds ?? DEFAULT_FEATURE_IDS);
  const [landmarkNearM, setLandmarkNearM] = useState<Record<string, number>>(() => ({
    ...defaultLandmarkNearM(),
    ...seeded?.landmarkNearM,
  }));
  const [nearDrafts, setNearDrafts] = useState<Record<string, string>>({});
  const dismissedAutoNames = useRef({ pois: new Set<string>(), trails: new Set<string>(), areas: new Set<string>() });
  const enabledFeatureIds = useRef<string[] | null>(null);
  const nearDebounce = useRef<number | null>(null);
  const [styleIds, setStyleIds] = useState<string[]>(() => {
    if (seeded?.styleIds?.length) return seeded.styleIds;
    if (refineFrom) return [styleIdFromRecord(refineFrom)];
    return [DEFAULT_POSTER_STYLE.id];
  });
  const [stylePrompt, setStylePrompt] = useState(seeded?.stylePrompt || DEFAULT_POSTER_STYLE.prompt);
  const [vibes, setVibes] = useState(seeded?.vibes ?? "");
  const [people, setPeople] = useState(seeded?.people ?? defaultPeople);
  const [peopleEnabled, setPeopleEnabled] = useState(seeded?.peopleEnabled ?? false);
  const [paletteIdsByStyle, setPaletteIdsByStyle] = useState<Record<string, string[]>>(
    () => seeded?.paletteIdsByStyle ?? {},
  );
  const [activeStyleId, setActiveStyleId] = useState(
    () => seeded?.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : DEFAULT_POSTER_STYLE.id),
  );
  const [activePlanKey, setActivePlanKey] = useState(() => {
    const id = seeded?.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : DEFAULT_POSTER_STYLE.id);
    if (!id) return "";
    const paletteId = paletteIdsForStyle(styleById(id), seeded?.paletteIdsByStyle?.[id])[0];
    return planSlotKey(id, paletteId);
  });
  const [title, setTitle] = useState(seeded?.title ?? "");
  const [locationOverride, setLocationOverride] = useState<string | null>(seeded?.location ?? null);
  const [locationMode, setLocationMode] = useState<"place" | "coordinates">(seeded?.locationMode ?? "place");
  const [suggestedLocation, setSuggestedLocation] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const placeLocation = locationOverride ?? suggestedLocation;
  const [dateOverride, setDateOverride] = useState<string | null>(seeded?.dateOverride ?? null);
  const [sportOverride, setSportOverride] = useState<string | null>(seeded?.sportOverride ?? null);
  const [distanceOverrideMeters, setDistanceOverrideMeters] = useState<number | null>(seeded?.distanceOverrideMeters ?? null);
  const [distanceDraft, setDistanceDraft] = useState<string | null>(null);
  const [startPlace, setStartPlace] = useState("");
  const [finishPlace, setFinishPlace] = useState("");
  const [placesEdited, setPlacesEdited] = useState(false);
  const [statIds, setStatIds] = useState<string[]>(DEFAULT_STAT_IDS);
  const [statUnits, setStatUnits] = useState<StatUnits>("metric");
  const [labels, setLabels] = useState<string[]>(() => seeded?.labels ?? []);
  const [trailNames, setTrailNames] = useState<string[]>(() => seeded?.trailNames ?? []);
  const [trailAliases, setTrailAliases] = useState<Record<string, string>>({});
  const [editingTrail, setEditingTrail] = useState<string | null>(null);
  const [editingTrailName, setEditingTrailName] = useState("");
  const [editingLandmark, setEditingLandmark] = useState<string | null>(null);
  const [editingLandmarkName, setEditingLandmarkName] = useState("");
  const [areaNames, setAreaNames] = useState<string[]>(() => seeded?.areaNames ?? []);
  const allowRefineAutoNames = useRef(false);
  const [customPois, setCustomPois] = useState<PosterPoi[]>([]);
  const [customWays, setCustomWays] = useState<NamedWay[]>([]);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const location = locationMode === "coordinates" ? cropCoordinates(context?.latlng ?? [], cropStart, cropEnd) : placeLocation;
  const [showRouteMarkers, setShowRouteMarkers] = useState(seeded?.showRouteMarkers ?? true);
  const routeOnly = true; // Annotations are paused; retain saved annotation data for older posters.
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [landmarkChoices, setLandmarkChoices] = useState<PosterPoi[] | null>(null);
  const [landmarkHint, setLandmarkHint] = useState<string | null>(null);
  const aspectRatio = seeded?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const variants = DEFAULT_VARIANTS;
  const [schematicUrl, setSchematicUrl] = useState<string | null>(null);
  const [routeReferenceUrl, setRouteReferenceUrl] = useState<string | null>(null);
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);
  const [satelliteShot, setSatelliteShot] = useState<SatelliteFrame | null>(null);
  const satelliteShotRef = useRef<{ frame: SatelliteFrame; key: string } | null>(null);
  const referenceUpload = useRef(createReferenceUploadCache(uploadPosterReferences));
  const [, setModelRefs] = useState<ModelRef[]>([]);
  const [maxRefs, setMaxRefs] = useState(3);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [workflowStep, setWorkflowStep] = useState<PosterWorkflowStep>("crop");
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>(() => (refineFrom ? "customize" : "launch"));
  const [specs, setSpecs] = useState<Partial<Record<string, PosterSpec>>>({});
  const [planCosts, setPlanCosts] = useState<Partial<Record<string, number | null>>>(() => seeded?.planCosts ?? {});
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const cropActivityId = useRef<number | null>(null);

  useEffect(() => {
    return () => onHighlightChange?.(null);
  }, [activityId]);
  const featureQuery = useMemo(
    () => contextFeatureQuery(featureIds, landmarkNearM, catalog),
    [featureIds, landmarkNearM, catalog],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPosterCapabilities().then((caps) => {
      if (cancelled) return;
      const configuredModel = uiImageModelFromCapabilities(caps.models, caps.defaultModel);
      const models = configuredModel ? [configuredModel] : [];
      setImageModels(models);
      setMaxRefs(minMaxReferences(models.map((model) => model.id), models) || caps.maxReferences);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sheetMode = sheetSnap != null;
  /** New poster prompts use the model configured by OPENROUTER_IMAGE_MODEL. */
  const activeImageModelIds = imageModels.map((model) => model.id);
  const imageModelFor = (id: string) => imageModels.find((model) => model.id === id);

  useEffect(() => {
    let cancelled = false;
    const activityChanged = cropActivityId.current !== activityId;
    setLoading(true);
    if (activityChanged) {
      setContext(null);
      setError(null);
    }
    fetchPosterContext(activityId, featureIds, featureQuery)
      .then((next) => {
        if (cancelled) return;
        setContext(next);
        const incomingPois = next.pois.map((poi) => poi.name);
        const incomingTrails = (next.namedWays ?? []).map((trail) => trail.name);
        const incomingAreas = (next.namedAreas ?? []).map((area) => area.name);
        if (activityChanged) enabledFeatureIds.current = null;
        const newlyEnabled = addedFeatureIds(enabledFeatureIds.current, featureIds);
        enabledFeatureIds.current = featureIds;
        forgetDismissedForLayers(dismissedAutoNames.current.pois, next.pois, newlyEnabled);
        forgetDismissedForLayers(dismissedAutoNames.current.trails, next.namedWays ?? [], newlyEnabled);
        forgetDismissedForLayers(dismissedAutoNames.current.areas, next.namedAreas ?? [], newlyEnabled);
        if (activityChanged) {
          cropActivityId.current = activityId;
          setMobileSurface(refineFrom ? "customize" : "launch");
          setWorkflowStep("crop");
          if (refineFrom) onSheetSnapChange?.("half");
          setEditingTrail(null);
          setLandmarkQuery("");
          setLandmarkChoices(null);
          setLandmarkHint(null);
          if (refineFrom) {
            const restored = restoreEditor(refineFrom, next.latlng.length, {
              title: next.activity.name || "Ride",
              labels: [],
              trailNames: [],
              areaNames: [],
            });
            setGeographyMode(restored.geographyMode ?? "manual");
            setFeatureIds(restored.featureIds);
            enabledFeatureIds.current = restored.featureIds;
            allowRefineAutoNames.current = false;
            setLandmarkNearM({ ...defaultLandmarkNearM(catalog), ...restored.landmarkNearM });
            seedDismissed(incomingPois, restored.labels, dismissedAutoNames.current.pois);
            seedDismissed(incomingTrails, restored.trailNames, dismissedAutoNames.current.trails);
            seedDismissed(incomingAreas, restored.areaNames, dismissedAutoNames.current.areas);
            setLabels(restored.labels);
            setTrailNames(restored.trailNames);
            setTrailAliases(restored.trailAliases);
            setAreaNames(restored.areaNames);
            setCustomPois(restored.customPois);
            setCustomWays(restored.customWays);
            setCropStart(restored.cropStart);
            setCropEnd(restored.cropEnd);
            setShowRouteMarkers(restored.showRouteMarkers);

            setTitle(restored.title);
            setLocationOverride(restored.location ?? null);
            setLocationMode(restored.locationMode);
            setDateOverride(restored.dateOverride);
            setSportOverride(restored.sportOverride);
            setDistanceOverrideMeters(restored.distanceOverrideMeters);
            setStartPlace(restored.startPlace);
            setFinishPlace(restored.finishPlace);
            setPlacesEdited(restored.placesEdited);
            setStatIds(restored.statIds);
            setStatUnits(restored.statUnits);
            if (sheetSnap != null) {
              const keepStyleId = restored.styleIds.find((id) => id !== "custom") ?? "";
              const keepPalette = keepStyleId
                ? [restored.paletteIdsByStyle[keepStyleId]?.[0] ?? AUTO_PALETTE_ID]
                : [];
              setStyleIds(keepStyleId ? [keepStyleId] : []);
              setPaletteIdsByStyle(keepStyleId ? { [keepStyleId]: keepPalette } : {});
              setActiveStyleId(keepStyleId);
              setActivePlanKey(keepStyleId ? planSlotKey(keepStyleId, keepPalette[0]) : "");
            } else {
              setStyleIds(restored.styleIds);
              setPaletteIdsByStyle(restored.paletteIdsByStyle);
              const first =
                restored.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : "");
              setActiveStyleId(first);
              setActivePlanKey(
                first
                  ? planSlotKey(first, restored.paletteIdsByStyle[first]?.[0] ?? AUTO_PALETTE_ID)
                  : "",
              );
            }
            setStylePrompt(restored.stylePrompt);
            setVibes(restored.vibes);
            setPeople(restored.people);
            setPeopleEnabled(restored.peopleEnabled);
            setSpecs({}); // Replan saved setups with the current reference images and prompt rules.
            setPlanCosts(restored.planCosts);
          } else {
            dismissedAutoNames.current.pois.clear();
            dismissedAutoNames.current.trails.clear();
            dismissedAutoNames.current.areas.clear();
            allowRefineAutoNames.current = false;
            setLabels(incomingPois);
            setTrailNames(incomingTrails);
            setAreaNames(incomingAreas);
            setTitle(next.activity.name || "Ride");
            setLocationOverride(null);
            setLocationMode("place");
            setDateOverride(null);
            setSportOverride(null);
            setDistanceOverrideMeters(null);
            setSuggestedLocation("");
            setCropStart(0);
            setCropEnd(Math.max(1, next.latlng.length - 1));
            setPlacesEdited(false);
            setStatIds(DEFAULT_STAT_IDS);
            setStatUnits("metric");
            setPeople(defaultPeople);
            setPeopleEnabled(false);
            setStartPlace("");
            setFinishPlace("");
            setCustomPois([]);
            setCustomWays([]);
            setTrailAliases({});
          }
        } else {
          const last = Math.max(1, next.latlng.length - 1);
          setCropStart((start) => Math.min(start, last - 1));
          setCropEnd((end) => Math.min(Math.max(end, 1), last));
          if (!refineFrom || allowRefineAutoNames.current) {
            setLabels((current) => takeFreshNames(current, incomingPois, dismissedAutoNames.current.pois));
            setTrailNames((current) => takeFreshNames(current, incomingTrails, dismissedAutoNames.current.trails));
            setAreaNames((current) => takeFreshNames(current, incomingAreas, dismissedAutoNames.current.areas));
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load image setup");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, featureQuery]);

  const croppedLatLng = useMemo(() => {
    if (!context?.latlng?.length) return [];
    return sliceTrack(context.latlng, cropStart, cropEnd);
  }, [context, cropStart, cropEnd]);
  const croppedRouteBreaks = useMemo(() => context
    ? sliceTrackBreaks(context.routeBreaks ?? [], context.latlng.length, cropStart, cropEnd) : [],
  [context, cropStart, cropEnd]);

  const corridorMeters = useMemo(() => {
    const limits = context?.corridor;
    if (!limits) return null;
    const clamp = (meters: number) => Math.min(limits.maxM, Math.max(limits.minM, meters));
    if (corridorOverride != null) return clamp(corridorOverride);
    const fullTrack = croppedLatLng.length === context.latlng.length;
    if (fullTrack) return clamp(limits.meters);
    return clamp(defaultCorridorM(croppedLatLng, isClosedLoop(croppedLatLng, croppedRouteBreaks)));
  }, [context, corridorOverride, croppedLatLng, croppedRouteBreaks]);

  const shapeRing = useMemo(() => {
    if (croppedLatLng.length < 2) return null;
    if (geoScope === "box") return rotatedBoxRing(croppedLatLng, shapePadM(croppedLatLng));
    if (geoScope === "hull") return convexHullRing(croppedLatLng, shapePadM(croppedLatLng));
    if (geoScope === "loop") return loopBandRing(croppedLatLng, 180);
    if (geoScope === "polygon") return polygon.points.length >= 3 ? polygon.points : null;
    if (geoScope === "rectangle") return rectangle.points.length >= 3 ? rectangle.points : null;
    return null;
  }, [croppedLatLng, geoScope, polygon.points, rectangle.points]);

  const editingOutline = geoScope === "polygon" || geoScope === "rectangle";
  const activeOutline = geoScope === "rectangle" ? rectangle : polygon;

  const onGeoOutlineChangeRef = useRef(onGeoOutlineChange);
  onGeoOutlineChangeRef.current = onGeoOutlineChange;
  useEffect(() => {
    onGeoOutlineChangeRef.current?.({
      active: editingOutline,
      preview: !editingOutline && (shapeRing?.length ?? 0) >= 3,
      kind: geoScope === "rectangle" ? "rectangle" : "polygon",
      points: editingOutline ? activeOutline.points : shapeRing ?? [],
      selected: editingOutline ? activeOutline.selected : null,
      rectPending: geoScope === "rectangle" && rectAnchor != null,
    });
  }, [editingOutline, geoScope, activeOutline, shapeRing, rectAnchor]);



  const polygonRef = useRef(polygon);
  const rectangleRef = useRef(rectangle);
  const rectAnchorRef = useRef(rectAnchor);
  const geoScopeRef = useRef(geoScope);
  polygonRef.current = polygon;
  rectangleRef.current = rectangle;
  rectAnchorRef.current = rectAnchor;
  geoScopeRef.current = geoScope;
  const polygonDrag = useRef<LngLat[] | null>(null);
  const rectResize = useRef<{ opposite: LngLat; base: LngLat[] } | null>(null);
  const rectDraftBase = useRef<LngLat[] | null>(null);

  const handleGeoEdit = useCallback((edit: GeoEdit) => {
    if (geoScopeRef.current === "polygon") {
      if (edit.type === "add") setPolygon((state) => appendOutlinePoint(state, [edit.lng, edit.lat]));
      else if (edit.type === "select") setPolygon((state) => ({ ...state, selected: edit.index }));
      else if (edit.type === "remove") setPolygon((state) => removeOutlinePoint(state, edit.index));
      else if (edit.type === "move-start") {
        polygonDrag.current = polygonRef.current.points.map((point) => [point[0], point[1]]);
      } else if (edit.type === "move") {
        setPolygon((state) =>
          liveOutline(
            state,
            state.points.map((point, index) => (index === edit.index ? [edit.lng, edit.lat] : point)),
            edit.index,
          ),
        );
      } else if (edit.type === "move-end") {
        const base = polygonDrag.current;
        polygonDrag.current = null;
        if (!base) return;
        setPolygon((state) =>
          pointsChanged(base, state.points) ? { ...state, past: [...state.past, base].slice(-50), future: [] } : state,
        );
      }
      return;
    }
    if (geoScopeRef.current !== "rectangle") return;
    if (edit.type === "select") setRectangle((state) => ({ ...state, selected: edit.index }));
    else if (edit.type === "rect-start") {
      rectDraftBase.current = rectangleRef.current.points.map((point) => [point[0], point[1]]);
      setRectAnchor([edit.lng, edit.lat]);
    } else if (edit.type === "rect-preview" && rectAnchorRef.current) {
      setRectangle((state) => liveOutline(state, rectangleRing(rectAnchorRef.current as LngLat, [edit.lng, edit.lat]), null));
    } else if (edit.type === "rect-commit" && rectAnchorRef.current) {
      const ring = rectangleRing(rectAnchorRef.current, [edit.lng, edit.lat]);
      const base = rectDraftBase.current ?? [];
      setRectAnchor(null);
      rectDraftBase.current = null;
      if (rectangleTooSmall(ring)) {
        setRectangle((state) => liveOutline(state, base, null));
        return;
      }
      setRectangle((state) => commitOutline({ ...state, points: base }, ring, null));
    } else if (edit.type === "move-start" && rectangleRef.current.points.length === 4) {
      const opposite = rectangleRef.current.points[(edit.index + 2) % 4];
      rectResize.current = {
        opposite: [opposite[0], opposite[1]],
        base: rectangleRef.current.points.map((point) => [point[0], point[1]]),
      };
    } else if (edit.type === "move" && rectResize.current) {
      const ring = rectangleRing([edit.lng, edit.lat], rectResize.current.opposite);
      setRectangle((state) => liveOutline(state, ring, null));
    } else if (edit.type === "move-end") {
      const resize = rectResize.current;
      rectResize.current = null;
      if (!resize) return;
      setRectangle((state) =>
        pointsChanged(resize.base, state.points) ? { ...state, past: [...state.past, resize.base].slice(-50), future: [] } : state,
      );
    }
  }, []);

  useEffect(() => {
    onBindGeoEdit?.(handleGeoEdit);
  }, [onBindGeoEdit, handleGeoEdit]);

  useEffect(() => {
    if (geoScope !== "polygon" && geoScope !== "rectangle") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const meta = event.metaKey || event.ctrlKey;
      const apply = geoScope === "polygon" ? setPolygon : setRectangle;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        apply((state) => (event.shiftKey ? redoOutline(state) : undoOutline(state)));
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        apply(redoOutline);
      } else if (event.key === "Escape" && geoScope === "rectangle" && rectAnchorRef.current) {
        const base = rectDraftBase.current;
        setRectAnchor(null);
        rectDraftBase.current = null;
        if (base) setRectangle((state) => liveOutline(state, base, null));
      } else if ((event.key === "Backspace" || event.key === "Delete") && geoScope === "polygon") {
        setPolygon((state) => (state.selected == null ? state : removeOutlinePoint(state, state.selected)));
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [geoScope]);

  const stopIndexes = useMemo(() => {
    const last = Math.max(0, (context?.latlng.length ?? 1) - 1);
    return [...new Set((context?.stops ?? []).filter((index) => index >= 0 && index <= last))].sort((a, b) => a - b);
  }, [context]);

  const stopLatLng = useMemo(() => {
    if (!context?.latlng?.length) return [];
    return stopIndexes.map((index) => context.latlng[index]).filter(Boolean);
  }, [context, stopIndexes]);

  // context.pois arrive ranked by the API (kind weight minus distance);
  // user-added landmarks go first so they stay prominent in the prompt.
  const selectedPlaceNames = useMemo(() => new Set([...labels, ...areaNames]), [labels, areaNames]);

  const selectedPois = useMemo(() => {
    const suggested = (context?.pois ?? []).filter((poi) => selectedPlaceNames.has(poi.name));
    const ranked = prioritizeLabels(suggested, customPois);
    if (croppedLatLng.length < 2) return ranked;
    const customNames = new Set(customPois.map((poi) => poi.name.trim().toLowerCase()));
    return ranked.filter(
      (poi) =>
        customNames.has(poi.name.trim().toLowerCase()) ||
        isNearCroppedRoute(poi, croppedLatLng, nearRouteMForKind(poi.kind, landmarkNearM)),
    );
  }, [context, selectedPlaceNames, customPois, croppedLatLng, landmarkNearM]);

  const selectedNamedWays = useMemo(() => {
    const suggested = (context?.namedWays ?? []).filter((trail) => trailNames.includes(trail.name));
    const ranked = prioritizeLabels(suggested, customWays);
    const colored = assignTrailColors(ranked).map((trail) => applyTrailAlias(trail, trailAliases));
    if (!context?.latlng?.length) return colored;
    const [lo, hi] = clampCrop(context.latlng.length, cropStart, cropEnd);
    return colored
      .map((trail) => ({
        ...trail,
        routeSpans: shiftRouteSpans(trail.routeSpans, lo, hi),
      }))
      .filter((trail) => trail.routeSpans === undefined || trail.routeSpans.length > 0);
  }, [context, trailNames, customWays, cropStart, cropEnd, trailAliases]);

  const selectedNamedAreas = useMemo(() => {
    const areas = (context?.namedAreas ?? []).filter((area) => selectedPlaceNames.has(area.name));
    const nearRoute =
      croppedLatLng.length < 2
        ? areas
        : areas.filter((area) => isNearCroppedRoute(area, croppedLatLng, nearRouteMForKind(area.kind, landmarkNearM)));
    return assignAreaLetters(nearRoute);
  }, [context, selectedPlaceNames, croppedLatLng, landmarkNearM]);

  const posterPois = routeOnly ? EMPTY_POIS : selectedPois;
  const posterWays = routeOnly ? EMPTY_WAYS : selectedNamedWays;
  const posterAreas = routeOnly ? EMPTY_AREAS : selectedNamedAreas;
  const displayBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return context?.bbox ?? null;
    return paddedBbox(croppedLatLng, [...posterPois, ...posterWays, ...posterAreas]);
  }, [context, croppedLatLng, posterPois, posterWays, posterAreas]);
  const groundingBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return displayBbox;
    return schematicBbox(croppedLatLng, [...posterPois, ...posterWays, ...posterAreas], landmarkNearM);
  }, [croppedLatLng, posterPois, posterWays, posterAreas, displayBbox, landmarkNearM]);
  const geographyFrameKey = groundingBbox ? JSON.stringify([activityId, groundingBbox.flat().map(n => Number(n.toFixed(7))), aspectRatio, geographyMode]) : "";
  const geographyScene = geographyResult?.key === geographyFrameKey ? geographyResult.scene : null;
  const geographyAllowance = geographyScene ? automaticGeographyAllowance(geographyScene.profile, geographyScene.source) : null;
  const geographyPending = Boolean(geographyFrameKey && !geographyScene && !geographyError);
  useEffect(() => {
    if (!geographyFrameKey) return;
    let cancelled = false;
    setGeographyError(null);
    const timer = window.setTimeout(() => {
      const [id, bbox, aspect, mode] = JSON.parse(geographyFrameKey);
      const savedScene = seeded?.geographyFrameKey === geographyFrameKey ? seeded.geographySceneId : undefined;
      void fetchPosterGeography(id, bbox, aspect, mode, savedScene).then(scene => {
        if (!cancelled) setGeographyResult({ key: geographyFrameKey, scene });
      }).catch((err: unknown) => {
        if (!cancelled) setGeographyError(err instanceof Error ? err.message : "Could not load geography");
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [geographyFrameKey, geographyRetry, GEOGRAPHY_VERSION]);
  const geographyWays = useMemo(() => geographyScene
    ? { ...geographyScene.ways, cemeteries: context?.ways.cemeteries ?? { type: "FeatureCollection" as const, features: [] } }
    : null, [geographyScene, context?.ways.cemeteries]);
  const visibleWays = useMemo(() => {
    if (!geographyWays) return null;
    if (croppedLatLng.length < 2 || geoScope === "all") return geographyWays;
    if (geoScope === "corridor" || geoScope === "ends") {
      return clipWaysSoftThenHard(geographyWays, croppedLatLng, geoScope, { corridorM: corridorMeters });
    }
    if (shapeRing && shapeRing.length >= 3) {
      return clipWaysSoftThenHard(geographyWays, croppedLatLng, "ring", { ring: shapeRing });
    }
    return geographyWays;
  }, [geographyWays, croppedLatLng, corridorMeters, geoScope, shapeRing]);

  const satelliteMask = useMemo((): GeoMask | null => {
    return satelliteReferenceMask({
      queryBbox: geographyScene ? [[geographyScene.bbox[0], geographyScene.bbox[1]], [geographyScene.bbox[2], geographyScene.bbox[3]]] : groundingBbox,
      exactFrame: Boolean(geographyScene),
      track: context?.latlng,
      route: croppedLatLng,
      scope: geoScope === "corridor" || geoScope === "ends" ? geoScope : geoScope === "all" ? "all" : "ring",
      corridorM: corridorMeters,
      ring: shapeRing,
    });
  }, [context, groundingBbox, geographyScene, croppedLatLng, geoScope, shapeRing, corridorMeters]);
  const resolvedFeatureIds = useMemo(() => {
    const selected = geographyMode === "auto"
      ? [...Object.keys(GEOGRAPHY_BUCKETS).filter(id => id !== "cemeteries"), ...featureIds.filter(id => id === "cemeteries")]
      : featureIds;
    return visibleGeographyIds(visibleWays ?? {}, selected);
  }, [geographyMode, featureIds, visibleWays]);
  const hasGeographyLayers = resolvedFeatureIds.length > 0;
  const schematicLayers = useMemo(() => ({
    ...schematicLayersFromFeatureIds(resolvedFeatureIds, routeMarkerMode(showRouteMarkers, croppedLatLng)),
    labels: !routeOnly,
  }), [resolvedFeatureIds, showRouteMarkers, croppedLatLng, routeOnly]);

  useEffect(() => {
    onGeoMaskChange?.(satelliteMask);
  }, [satelliteMask, onGeoMaskChange]);
  const satelliteBbox = groundingBbox;

  const nearbyEndpoints = useMemo(() => isClosedLoop(croppedLatLng), [croppedLatLng]);

  const suggestedPlaces = useMemo(() => {
    if (croppedLatLng.length < 2) return { start: "", finish: "" };
    return {
      start: nearestPlaceName(selectedPois, selectedNamedAreas, croppedLatLng[0]),
      finish: nearestPlaceName(selectedPois, selectedNamedAreas, croppedLatLng[croppedLatLng.length - 1]),
    };
  }, [croppedLatLng, selectedPois, selectedNamedAreas]);

  useEffect(() => {
    if (placesEdited) return;
    setStartPlace(suggestedPlaces.start);
    setFinishPlace(nearbyEndpoints ? suggestedPlaces.start : suggestedPlaces.finish);
  }, [suggestedPlaces, nearbyEndpoints, placesEdited]);

  const samePlace = nearbyEndpoints;

  useEffect(() => {
    if (!context || cropActivityId.current !== activityId) return;
    let cancelled = false;
    setSuggestedLocation("");
    setLocationStatus("Finding location…");
    const timer = window.setTimeout(() => {
      void fetchPosterLocation(activityId, cropStart, cropEnd).then(result => {
        if (cancelled) return;
        setSuggestedLocation(result.location);
        setLocationStatus(result.resolved ? "" : "Place lookup unavailable. Enter a location.");
      }).catch(() => {
        if (!cancelled) setLocationStatus("Location lookup failed. Enter a location.");
      });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activityId, Boolean(context), cropStart, cropEnd]);

  const listedStats = useMemo((): FormattedStat[] => {
    const available = applyStatUnits(
      (context?.stats ?? []).filter((item) => item.id !== "title" && item.id !== "location"),
      context?.activity,
      statUnits,
    );
    const edited = available.map(stat => ({ ...stat, value: stat.id === "date" ? dateOverride ?? stat.value : stat.id === "sport" ? sportOverride ?? stat.value : stat.id === "distance" && distanceOverrideMeters !== null ? formatDistance(distanceOverrideMeters, statUnits) : stat.value }));
    return [{ id: "title", label: "Title", value: title }, ...edited, { id: "location", label: "Location", value: location.trim() }];
  }, [context, title, statUnits, location, dateOverride, sportOverride, distanceOverrideMeters]);

  const selectedStats = useMemo(() => {
    return listedStats.filter((item) => statIds.includes(item.id) && (item.id === "title" || item.value));
  }, [listedStats, statIds]);

  const subtitle = useMemo(() => {
    return selectedStats
      .filter((item) => item.id !== "title" && item.id !== "location")
      .map((item) => item.value)
      .join(" · ");
  }, [selectedStats]);

  const peopleNames = useMemo(() => parsePeople(people, peopleEnabled), [people, peopleEnabled]);
  const posterStats = useMemo(() => {
    const stats = selectedStats.map((item) => ({ label: item.label, value: item.value }));
    if (peopleNames.length) stats.push({ label: "With", value: formatPeople(peopleNames) });
    return stats;
  }, [selectedStats, peopleNames]);

  useEffect(() => {
    onCropChange?.(croppedLatLng.length >= 2 ? croppedLatLng : null);
  }, [croppedLatLng, onCropChange]);

  useEffect(() => { onBreaksChange?.(croppedRouteBreaks); }, [croppedRouteBreaks, onBreaksChange]);

  useEffect(() => {
    onStopsChange?.(stopLatLng);
  }, [stopLatLng, onStopsChange]);

  useEffect(() => {
    onPoisChange?.(posterPois);
  }, [posterPois, onPoisChange]);

  useEffect(() => {
    onNamedWaysChange?.(posterWays);
  }, [posterWays, onNamedWaysChange]);

  useEffect(() => {
    onNamedAreasChange?.(posterAreas);
  }, [posterAreas, onNamedAreasChange]);

  useEffect(() => {
    onRouteOnlyChange?.(routeOnly);
  }, [routeOnly, onRouteOnlyChange]);

  useEffect(() => {
    onWaysChange?.(visibleWays);
  }, [visibleWays, onWaysChange]);

  useEffect(() => {
    onSchematicLayersChange?.(schematicLayers);
  }, [schematicLayers, onSchematicLayersChange]);

  const removePoi = useCallback((name: string) => {
    dismissedAutoNames.current.pois.add(name);
    setCustomPois((current) => current.filter((item) => item.name !== name));
    setLabels((current) => current.filter((item) => item !== name));
  }, []);

  const removeArea = useCallback((name: string) => {
    dismissedAutoNames.current.areas.add(name);
    setAreaNames((current) => current.filter((item) => item !== name));
  }, []);

  const removeTrail = useCallback((name: string) => {
    const source = trailSourceName(name, trailAliases);
    dismissedAutoNames.current.trails.add(source);
    setCustomWays((current) => current.filter((item) => item.name !== source));
    setTrailNames((current) => current.filter((item) => item !== source));
    setTrailAliases((current) => {
      if (!(source in current)) return current;
      const next = { ...current };
      delete next[source];
      return next;
    });
    setEditingTrail((current) => (current === name || current === source ? null : current));
  }, [trailAliases]);

  const renameTrail = useCallback(
    (from: string, to: string) => {
      const taken = selectedNamedWays.map((trail) => trail.name);
      const result = nextTrailAliases(from, to, trailAliases, taken);
      if ("error" in result) {
        setLandmarkHint(result.error);
        return false;
      }
      setTrailAliases(result.aliases);
      setLandmarkHint(`Renamed stretch to “${result.display}”`);
      setEditingTrail(null);
      return true;
    },
    [selectedNamedWays, trailAliases],
  );

  const renameLandmark = useCallback(
    (from: string, to: string) => {
      const key = from.trim().toLowerCase();
      const poi = selectedPois.find((item) => item.name.trim().toLowerCase() === key);
      if (!poi) return false;
      const result = renamedLandmark(poi, to, selectedPois.map((item) => item.name));
      if ("error" in result) {
        setLandmarkHint(result.error);
        return false;
      }
      const nextName = result.name;
      if (nextName === poi.name) {
        setEditingLandmark(null);
        return true;
      }
      dismissedAutoNames.current.pois.add(poi.name);
      dismissedAutoNames.current.pois.delete(nextName);
      setCustomPois((current) => {
        const match = current.findIndex((item) => item.name.trim().toLowerCase() === key);
        if (match < 0) return [...current, result];
        const copy = [...current];
        copy[match] = result;
        return copy;
      });
      setLabels((current) => {
        const next = current.map((item) => (item.trim().toLowerCase() === key ? nextName : item));
        return next.some((item) => item.trim().toLowerCase() === nextName.toLowerCase()) ? next : [...next, nextName];
      });
      setSelectedChip((current) =>
        current?.kind === "poi" && current.name.trim().toLowerCase() === key
          ? { kind: "poi", name: nextName }
          : current,
      );
      onHighlightChange?.(null);
      setLandmarkHint(`Renamed landmark to “${nextName}”`);
      setEditingLandmark(null);
      return true;
    },
    [selectedPois, onHighlightChange],
  );

  useEffect(() => {
    if (!dismissPoi?.name) return;
    removePoi(dismissPoi.name);
  }, [dismissPoi, removePoi]);

  useEffect(() => {
    if (!dismissArea?.name) return;
    removeArea(dismissArea.name);
  }, [dismissArea, removeArea]);

  useEffect(() => {
    if (!dismissTrail?.name) return;
    removeTrail(dismissTrail.name);
  }, [dismissTrail, removeTrail]);

  useEffect(() => {
    if (!placeLandmark?.name) return;
    const route = croppedLatLng.length >= 2 ? croppedLatLng : context?.latlng ?? [];
    const poi = userLandmark(
      placeLandmark.name,
      placeLandmark.lat,
      placeLandmark.lng,
      route,
      displayBbox ?? context?.bbox,
    );
    if (!poi) return;
    addCustom(poi);
    setLandmarkHint(`Added ${poi.name} on the schematic`);
  }, [placeLandmark]);

  useEffect(() => {
    if (!moveLandmark?.name) return;
    const route = croppedLatLng.length >= 2 ? croppedLatLng : context?.latlng ?? [];
    const bbox = displayBbox ?? context?.bbox;
    const key = moveLandmark.name.trim().toLowerCase();
    const existing =
      customPois.find((item) => item.name.trim().toLowerCase() === key) ??
      selectedPois.find((item) => item.name.trim().toLowerCase() === key) ??
      (context?.pois ?? []).find((item) => item.name.trim().toLowerCase() === key);
    const poi = existing
      ? relocateLandmark(existing, moveLandmark.lat, moveLandmark.lng, route, bbox)
      : userLandmark(moveLandmark.name, moveLandmark.lat, moveLandmark.lng, route, bbox);
    if (!poi) return;
    const name = existing?.name ?? poi.name;
    setCustomPois((current) => {
      const match = current.findIndex((item) => item.name.trim().toLowerCase() === key);
      const next = { ...poi, name };
      if (match >= 0) {
        const copy = [...current];
        copy[match] = next;
        return copy;
      }
      return [...current, next];
    });
    dismissedAutoNames.current.pois.delete(name);
    setLabels((current) => (current.includes(name) ? current : [...current, name]));
    setLandmarkHint(`Moved ${name}`);
  }, [moveLandmark]);

  useEffect(() => {
    if (!placeSection?.name || !context?.latlng?.length) return;
    const [lo] = clampCrop(context.latlng.length, cropStart, cropEnd);
    const start = lo + Math.min(placeSection.start, placeSection.end);
    const end = lo + Math.max(placeSection.start, placeSection.end);
    const source = trailSourceName(placeSection.name, trailAliases);
    const existing = selectedNamedWays.find((trail) => trailSourceName(trail.name, trailAliases) === source);
    const way = existing
      ? resizedNamedWay({ ...existing, name: source }, start, end, context.latlng, displayBbox ?? context.bbox)
      : userNamedWay(source, start, end, context.latlng, displayBbox ?? context.bbox);
    if (!way) return;
    addCustomWay(way);
    setTrailNames((current) => (current.includes(source) ? current : [...current, source]));
    dismissedAutoNames.current.trails.delete(source);
    setLandmarkHint(existing ? `Updated the extent of “${placeSection.name}”` : `Named “${way.name}” on the schematic`);
  }, [placeSection]);

  useEffect(() => {
    if (!renameTrailEvent?.name) return;
    renameTrail(renameTrailEvent.name, renameTrailEvent.next);
  }, [renameTrailEvent, renameTrail]);

  useEffect(() => {
    if (!renameLandmarkEvent?.name) return;
    renameLandmark(renameLandmarkEvent.name, renameLandmarkEvent.next);
  }, [renameLandmarkEvent, renameLandmark]);

  useEffect(
    () => () => {
      onCropChange?.(null);
      onBreaksChange?.([]);
      onStopsChange?.([]);
      onWaysChange?.(null);
      onSchematicLayersChange?.(null);
      onGeoMaskChange?.(null);
    },
    [onCropChange, onBreaksChange, onStopsChange, onWaysChange, onSchematicLayersChange, onGeoMaskChange],
  );

  useEffect(() => {
    if (croppedLatLng.length < 2 || !groundingBbox) {
      setSchematicUrl(null);
      setRouteReferenceUrl(null);
      setSatelliteUrl(null);
      return;
    }
    const renderStart = performance.now();
    try {
      setRouteReferenceUrl(renderSchematicDataUrl({
        latlng: croppedLatLng,
        routeBreaks: croppedRouteBreaks,
        bbox: groundingBbox,
        aspectRatio,
        silhouette: true,
        layers: { routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng) },
      }));
      setSchematicUrl(
        renderSchematicDataUrl({
          latlng: croppedLatLng,
          routeBreaks: croppedRouteBreaks,
          bbox: groundingBbox,
          ways: visibleWays ?? undefined,
          pois: posterPois,
          namedWays: posterWays,
          namedAreas: posterAreas,
          aspectRatio,
          layers: schematicLayers,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render schematic");
    } finally {
      performance.clearMeasures("schematic.render-and-png");
      performance.measure("schematic.render-and-png", { start: renderStart, end: performance.now() });
    }
  }, [visibleWays, croppedLatLng, croppedRouteBreaks, groundingBbox, posterPois, posterWays, posterAreas, aspectRatio, schematicLayers, showRouteMarkers]);

  useEffect(() => {
    if (croppedLatLng.length < 2 || !satelliteBbox || maxRefs < 3) {
      satelliteShotRef.current = null;
      setSatelliteShot(null);
      setSatelliteUrl(null);
      return;
    }
    satelliteShotRef.current = null;
    setSatelliteShot(null);
    setSatelliteUrl(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void snapshotTiles(
        {
          source: "satellite",
          bbox: satelliteBbox,
          aspectRatio,
        },
        controller.signal,
      )
        .then((shot) => {
          if (controller.signal.aborted) return;
          satelliteShotRef.current = { frame: shot, key: JSON.stringify([satelliteBbox, aspectRatio]) };
          setSatelliteShot(shot);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          satelliteShotRef.current = null;
          setSatelliteShot(null);
          setSatelliteUrl(null);
        });
    }, SATELLITE_SNAPSHOT_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [croppedLatLng, satelliteBbox, aspectRatio, maxRefs]);

  useEffect(() => {
    const shot = satelliteShot;
    if (!shot || croppedLatLng.length < 2) return;
    let cancelled = false;
    void renderMaskedSatellite(shot, {
      latlng: croppedLatLng,
      routeBreaks: croppedRouteBreaks,
      routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng),
      mask: satelliteMask,
    })
      .then((url) => {
        if (!cancelled) setSatelliteUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSatelliteUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [satelliteShot, satelliteMask, croppedLatLng, croppedRouteBreaks, showRouteMarkers]);

  useEffect(() => {
    const layers = groundingLayers(
      schematicUrl,
      routeReferenceUrl,
      satelliteUrl,
      maxRefs,
      croppedLatLng,
      showRouteMarkers,
      !routeOnly,
      hasGeographyLayers,
      maskIsActive(satelliteMask),
    );
    if (!layers.length) {
      setModelRefs([]);
      return;
    }
    let cancelled = false;
    void renderContactSheets(layers, maxRefs, aspectRatio).then((packed) => {
      if (!cancelled) setModelRefs(packed);
    });
    return () => {
      cancelled = true;
    };
  }, [
    schematicUrl,
    routeReferenceUrl,
    satelliteUrl,
    maxRefs,
    aspectRatio,
    showRouteMarkers,
    croppedLatLng,
    routeOnly,
    hasGeographyLayers,
    satelliteMask,
  ]);

  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [generating]);

  async function ensureSatellite(): Promise<string | null> {
    if (maxRefs < 3 || croppedLatLng.length < 2 || !satelliteBbox) return null;
    try {
      const key = JSON.stringify([satelliteBbox, aspectRatio]);
      const cached = satelliteShotRef.current;
      let shot = cached?.key === key ? cached.frame : null;
      if (!shot) {
        shot = await snapshotTiles({
          source: "satellite",
          bbox: satelliteBbox,
          aspectRatio,
        });
        satelliteShotRef.current = { frame: shot, key };
        setSatelliteShot(shot);
      }
      return await renderMaskedSatellite(shot, {
        latlng: croppedLatLng,
        routeBreaks: croppedRouteBreaks,
        routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng),
        mask: satelliteMask,
      });
    } catch {
      return null;
    }
  }

  async function buildGrounding(): Promise<GroundingLayer[]> {
    const satellite = await ensureSatellite();
    return groundingLayers(
      schematicUrl,
      routeReferenceUrl,
      satellite,
      maxRefs,
      croppedLatLng,
      showRouteMarkers,
      !routeOnly,
      hasGeographyLayers,
      maskIsActive(satelliteMask),
    );
  }

  function plannerRequest(packed: Awaited<ReturnType<typeof renderContactSheets>>, referenceBatchId: string, slot: { styleId: string; paletteId: string }) {
    const style = styleById(slot.styleId);
    const base = {
      referenceBatchId,
      activity: {
        name: context!.activity.name,
        sportType: context!.activity.sportType,
        isLoop: isClosedLoop(croppedLatLng, croppedRouteBreaks),
      },
      routeMarkers: {
        enabled: showRouteMarkers,
        mode: isClosedLoop(croppedLatLng, croppedRouteBreaks) ? "loop" as const : "start-finish" as const,
        startName: startPlace.trim() || undefined,
        finishName: (samePlace ? startPlace : finishPlace).trim() || undefined,
      },
      title,
      subtitle,
      stats: posterStats,
      people: peopleNames,
      aspectRatio,
      geography: catalog
        .filter(
          (item) =>
            (item.group === "geography" || item.id === "cemeteries") && resolvedFeatureIds.includes(item.id),
        )
        .map((item) => ({ id: item.id, label: item.label })),
      pois: posterPois,
      namedWays: posterWays,
      namedAreas: posterAreas,
      routeOnly,
      grounding: packed.map((sheet, index) => ({
        index: index + 1,
        role: sheet.role,
        legend: sheet.legend,
      })),
    };
    return {
      ...base,
      style: styleForPlan(style, slot.paletteId),
      customStylePrompt: style.id === "custom" ? stylePrompt : undefined,
      vibes: vibes.trim() || undefined,
      previousSpec:
        specForSlot(specs, slot.styleId, slot.paletteId) ??
        (refineFrom && refineFrom.styleId === slot.styleId ? refineFrom.spec : undefined),
    };
  }

  function generationRequest(slot: { key: string; styleId: string; paletteId: string }, model: string, batchId: string) {
    const job = { ...slot, model, style: styleById(slot.styleId) };
    return {
      activityId,
      featureIds,
      labels: posterPois.map((poi) => poi.name),
      stats: posterStats,
      styleId: job.styleId,
      paletteId: job.paletteId,
      stylePrompt:
        job.style.id === "custom"
          ? stylePrompt
          : resolveStyleColor(job.style, job.paletteId).prompt,
      aspectRatio,
      batchId,
      model: job.model,
      variants,
      editor: captureEditorSnapshot({
        geographyMode,
        routeDetail: false,
        detailScope: "none",
        geographyPolicyVersion: geographyScene?.policyVersion,
        geographySceneId: geographyScene?.sceneId,
        geographyFrameKey,
        featureIds,
        landmarkNearM,
        labels,
        trailNames,
        trailAliases,
        areaNames,
        customPois,
        customWays,
        cropStart,
        cropEnd,
        showRouteMarkers,
        routeOnly,
        title,
        location: locationOverride,
        locationMode,
        dateOverride,
        sportOverride,
        distanceOverrideMeters,
        startPlace,
        finishPlace,
        placesEdited,
        sharedPlace: null,
        statIds,
        statUnits,
        people,
        peopleEnabled,
        aspectRatio,
        styleIds,
        stylePrompt,
        vibes,
        paletteIdsByStyle,
        imageModelIds: activeImageModelIds,
        variants,
        specs,
        planCosts,
      }),
    };
  }

  async function handlePlanAndGenerate() {
    if (!geographyScene || !context || !activeImageModelIds.length) return;
    const slots = stylePlanSlots(styleIds, paletteIdsByStyle);
    if (!slots.length) return;
    const tasks = slots.flatMap(slot => activeImageModelIds.map(model => beginGeneration({
      title: title.trim() || "New image", styleId: slot.styleId, paletteId: slot.paletteId,
      model, variants: variantCount(variants, imageModelFor(model)?.maxImages),
    })));
    const submissionId = crypto.randomUUID();
    const batchId = refineFrom ? refineFrom.batchId || refineFrom.posterId : submissionId;
    // The upload is the only preparation that needs an open browser. The backend owns all provider work.
    let payload: Promise<Parameters<typeof submitPosterBatch>[0]> | undefined;
    const submit = async () => {
      payload ??= (async () => {
        const packed = await renderContactSheets(await buildGrounding(), maxRefs, aspectRatio);
        const uploaded = await referenceUpload.current(packed.map(sheet => sheet.dataUrl));
        return { submissionId, jobs: slots.flatMap(slot => activeImageModelIds.map(model => {
          const plan = plannerRequest(packed, uploaded.referenceBatchId, slot);
          const generate = generationRequest(slot, model, batchId);
          return { plan, generate: { ...generate, referenceBatchId: uploaded.referenceBatchId } };
        })) };
      })().catch(error => { payload = undefined; throw error; });
      await submitPosterBatch(await payload);
    };
    let retrying: Promise<void> | undefined;
    tasks.forEach(task => task.setRetry(() => retrying ??= submit()
      .then(() => { tasks.forEach(task => task.dismiss()); })
      .finally(() => { retrying = undefined; })));
    setGenerating(true);
    try {
      await submit();
      tasks.forEach(task => task.finish());
      onGenerationStarted?.();
    } catch (error) {
      tasks.forEach(task => task.finish(error));
      setError(error instanceof Error ? error.message : "Batch submission failed");
    } finally { setGenerating(false); }
  }

  function openCustomize() {
    setMobileSurface("customize");
    setWorkflowStep("crop");
    onSheetSnapChange?.("half");
  }

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    const query = landmarkQuery.trim();
    if (!query || !context || lookingUp) return;
    setLookingUp(true);
    setLandmarkHint(null);
    setLandmarkChoices(null);
    try {
      const found = await lookupPosterLandmark({
        query,
        activityId,
        bbox: displayBbox ?? context.bbox,
        latlng: croppedLatLng,
      });
      if (found.picked) {
        addCustom(found.picked);
        setLandmarkQuery("");
        setLandmarkHint(`Added ${found.picked.name}`);
      } else if (found.candidates.length) {
        setLandmarkChoices(found.candidates);
        setLandmarkHint("Several matches — pick one.");
      } else {
        setLandmarkHint(found.warnings[0] ?? "No location found for that name.");
      }
    } catch (err) {
      setLandmarkHint(err instanceof Error ? err.message : "Landmark lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  function addCustom(poi: PosterPoi) {
    setCustomPois((current) =>
      current.some((item) => item.name.toLowerCase() === poi.name.toLowerCase()) ? current : [...current, poi],
    );
    dismissedAutoNames.current.pois.delete(poi.name);
    setLabels((current) => (current.includes(poi.name) ? current : [...current, poi.name]));
    setLandmarkChoices(null);
  }

  function addCustomWay(way: NamedWay) {
    setCustomWays((current) => {
      const index = current.findIndex((item) => item.name.toLowerCase() === way.name.toLowerCase());
      if (index < 0) return [...current, way];
      const next = [...current];
      next[index] = way;
      return next;
    });
  }

  function toggleFeature(id: string) {
    if (refineFrom) allowRefineAutoNames.current = true;
    setFeatureIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function landmarkNearValue(id: string, fallback?: number) {
    return landmarkNearM[id] ?? fallback ?? 100;
  }

  function commitLandmarkNear(id: string, raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setNearDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    const meters = clampNearRouteM(parsed);
    setLandmarkNearM((current) => (current[id] === meters ? current : { ...current, [id]: meters }));
    setNearDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function draftLandmarkNear(id: string, raw: string) {
    setNearDrafts((current) => ({ ...current, [id]: raw }));
    if (nearDebounce.current != null) window.clearTimeout(nearDebounce.current);
    nearDebounce.current = window.setTimeout(() => commitLandmarkNear(id, raw), 450);
  }

  function styleForPlan(style: ReturnType<typeof styleById>, selectedPaletteId: string) {
    if (style.id === "custom") {
      return {
        id: style.id,
        label: style.label,
        prompt: stylePrompt,
        palette: [] as string[],
        typography: style.typography,
        openPalette: false,
      };
    }
    const resolved = resolveStyleColor(style, selectedPaletteId);
    return {
      id: style.id,
      label: style.label,
      prompt: resolved.prompt,
      palette: resolved.palette,
      typography: style.typography,
      openPalette: resolved.openPalette,
    };
  }

  function dropSlot(styleId: string, paletteId: string) {
    const key = planSlotKey(styleId, paletteId);
    const isDefault = paletteId === defaultPaletteId(styleById(styleId));
    const legacyKey = planSlotKey(styleId, AUTO_PALETTE_ID);
    setSpecs((current) => {
      if (!current[key] && !(isDefault && (current[legacyKey] || current[styleId]))) return current;
      const next = { ...current };
      delete next[key];
      if (isDefault) {
        delete next[styleId];
        delete next[legacyKey];
      }
      return next;
    });
    setPlanCosts((current) => {
      if (!(key in current) && !(isDefault && (legacyKey in current || styleId in current))) return current;
      const next = { ...current };
      delete next[key];
      if (isDefault) {
        delete next[styleId];
        delete next[legacyKey];
      }
      return next;
    });
  }

  function togglePalette(styleId: string, paletteId: string) {
    const style = styleById(styleId);
    const current = paletteIdsForStyle(style, paletteIdsByStyle[styleId]);
    const exclusive = sheetMode;
    const selected = exclusive
      ? [paletteId]
      : current.includes(paletteId)
        ? current.filter((item) => item !== paletteId)
        : [...current, paletteId];
    if (!selected.length) {
      toggleStyle(styleId);
      return;
    }
    const next = paletteIdsForStyle(style, selected);
    if (next.length === current.length && next.every((id, index) => id === current[index])) return;
    setPaletteIdsByStyle((map) => ({ ...map, [styleId]: next }));
    for (const id of current) {
      if (!next.includes(id)) dropSlot(styleId, id);
    }
    const added = !current.includes(paletteId) && next.includes(paletteId);
    const active = parsePlanSlotKey(activePlanKey);
    if (added) {
      setActiveStyleId(styleId);
      setActivePlanKey(planSlotKey(styleId, paletteId));
    } else if (active.styleId === styleId && !next.includes(active.paletteId)) {
      setActivePlanKey(planSlotKey(styleId, next[0]));
    }
  }

  /** Mobile sheet: one theme / palette at a time via compact selects. */
  function selectPalette(styleId: string, paletteId: string) {
    const style = styleById(styleId);
    const current = paletteIdsForStyle(style, paletteIdsByStyle[styleId]);
    const next = [normalizePaletteId(style, paletteId)];
    if (next.length === current.length && next[0] === current[0]) return;
    setPaletteIdsByStyle((map) => ({ ...map, [styleId]: next }));
    for (const id of current) {
      if (!next.includes(id)) dropSlot(styleId, id);
    }
    setActiveStyleId(styleId);
    setActivePlanKey(planSlotKey(styleId, next[0]));
  }

  function toggleStyle(id: string) {
    const exclusive = sheetMode;
    setStyleIds((current) => {
      if (current.includes(id) && (!exclusive || current.length === 1)) {
        const next = current.filter((item) => item !== id);
        setActiveStyleId((active) => (active === id ? next[0] ?? "" : active));
        setPaletteIdsByStyle((map) => {
          const copy = { ...map };
          delete copy[id];
          return copy;
        });
        for (const paletteId of paletteIdsForStyle(styleById(id), paletteIdsByStyle[id])) {
          dropSlot(id, paletteId);
        }
        const first = next[0];
        setActivePlanKey(
          first ? planSlotKey(first, paletteIdsForStyle(styleById(first), paletteIdsByStyle[first])[0]) : "",
        );
        return next;
      }
      if (exclusive) {
        for (const prev of current) {
          if (prev === id) continue;
          for (const paletteId of paletteIdsForStyle(styleById(prev), paletteIdsByStyle[prev])) {
            dropSlot(prev, paletteId);
          }
        }
      }
      setActiveStyleId(id);
      if (id === "custom" && !stylePrompt) {
        const from = styleById(activeStyleId);
        if (from.prompt) setStylePrompt(from.prompt);
      }
      const palettes = paletteIdsForStyle(styleById(id), [AUTO_PALETTE_ID]);
      setPaletteIdsByStyle((map) => (exclusive ? { [id]: palettes } : { ...map, [id]: palettes }));
      setActivePlanKey(planSlotKey(id, palettes[0]));
      return exclusive ? [id] : [...current, id];
    });
  }

  function selectStyle(id: string) {
    setStyleIds((current) => {
      for (const prev of current) {
        if (prev === id) continue;
        for (const paletteId of paletteIdsForStyle(styleById(prev), paletteIdsByStyle[prev])) {
          dropSlot(prev, paletteId);
        }
      }
      if (!id) {
        for (const prev of current) {
          for (const paletteId of paletteIdsForStyle(styleById(prev), paletteIdsByStyle[prev])) {
            dropSlot(prev, paletteId);
          }
        }
        setActiveStyleId("");
        setActivePlanKey("");
        setPaletteIdsByStyle({});
        return [];
      }
      setActiveStyleId(id);
      if (id === "custom" && !stylePrompt) {
        const from = styleById(activeStyleId);
        if (from.prompt) setStylePrompt(from.prompt);
      }
      const palettes = paletteIdsForStyle(styleById(id), paletteIdsByStyle[id] ?? [AUTO_PALETTE_ID]).slice(0, 1);
      setPaletteIdsByStyle({ [id]: palettes });
      setActivePlanKey(planSlotKey(id, palettes[0]));
      return [id];
    });
  }

  function applyExamplePalette(styleId: string, paletteId: string) {
    const nextPalette = normalizePaletteId(styleById(styleId), paletteId);
    for (const id of styleIds) {
      if (id !== styleId && !sheetMode) continue;
      for (const previous of paletteIdsForStyle(styleById(id), paletteIdsByStyle[id])) {
        if (id !== styleId || previous !== nextPalette) dropSlot(id, previous);
      }
    }
    setStyleIds((current) => sheetMode ? [styleId] : current.includes(styleId) ? current : [...current, styleId]);
    setPaletteIdsByStyle((current) => sheetMode ? { [styleId]: [nextPalette] } : { ...current, [styleId]: [nextPalette] });
    setActiveStyleId(styleId);
    setActivePlanKey(planSlotKey(styleId, nextPalette));
  }

  const showEditor = context != null && cropActivityId.current === activityId;
  const featuresRefreshing = (loading || geographyPending) && showEditor;
  const lastIndex = Math.max(1, (context?.latlng.length ?? 2) - 1);
  const croppedKm = trackDistanceM(croppedLatLng, croppedRouteBreaks);
  const busy = generating;
  const planDisabledHint = geographyError ? "Map detail could not load. Open Geography to retry." : !geographyScene ? "Preparing map detail…" : generating
      ? "Uploading references and submitting the batch…"
      : !styleIds.length && !title.trim()
        ? "Select a theme and add a title in Stats before generating."
        : !styleIds.length
          ? "Select a theme before generating."
          : !title.trim()
            ? "Add a title in Stats before generating."
            : geographyScene?.completeness === "fallback"
              ? "Detailed map data is temporarily unavailable; a generalized background will be used."
              : null;
  const planSlots = stylePlanSlots(styleIds, paletteIdsByStyle);
  const generateCount = planSlots.length * activeImageModelIds.reduce((sum, id) => {
    const maxImages = imageModelFor(id)?.maxImages;
    return sum + variantCount(variants, maxImages);
  }, 0);
  const editingCustom = styleIds.includes("custom");
  const paletteStyles = styleIds.map(styleById).filter(showsPalettePicker);
  const launchStyleId = styleIds[0] ?? DEFAULT_POSTER_STYLE.id;
  const launchPaletteId = paletteIdsForStyle(styleById(launchStyleId), paletteIdsByStyle[launchStyleId])[0];
  const launchThemeLabel = planSlotLabel(launchStyleId, launchPaletteId);

  function applyCrop(nextStart: number, nextEnd: number) {
    if (!context) return;
    const radius = snapRadius(context.latlng.length);
    const lo = nextStart === cropStart ? nextStart : snapIndex(nextStart, stopIndexes, radius);
    const hi = nextEnd === cropEnd ? nextEnd : snapIndex(nextEnd, stopIndexes, radius);
    const [start, end] = clampCrop(context.latlng.length, lo, hi);
    setCropStart(start);
    setCropEnd(end);
  }

  const launchMode = sheetMode && mobileSurface === "launch";
  const themeExamples = <ThemeExamples single={sheetMode} disabled={busy} selectedStyleIds={styleIds}
    paletteIdsByStyle={paletteIdsByStyle} onTogglePalette={(id, paletteId) => {
      if (!styleIds.includes(id)) applyExamplePalette(id, paletteId);
      else togglePalette(id, paletteId);
    }} onToggleTheme={toggleStyle} onSelectTheme={selectStyle} onApplyPalette={applyExamplePalette} />;
  const labelCount = selectedPois.length + selectedNamedWays.length + selectedNamedAreas.length;
  const showOnMapStep =
    sheetMode &&
    !launchMode &&
    !routeOnly &&
    (selectedNamedAreas.length > 0 || selectedNamedWays.length > 0 || selectedPois.length > 0);
  const workflowSteps = useMemo(() => {
    const steps: { id: PosterWorkflowStep; label: string; beta?: boolean }[] = [
      { id: "crop", label: "Crop" },
      { id: "geography", label: "Geography" },
    ];
    if (showOnMapStep) steps.push({ id: "on-map", label: "On map" });
    steps.push(
      { id: "stats", label: "Stats" },
      { id: "themes", label: "Themes" },
    );
    if (!sheetMode) {
      steps.push({ id: "output", label: "Output" });
    }
    return steps;
  }, [showOnMapStep, sheetMode]);
  const panelTitle = context?.activity.name ?? activityLabel ?? "Create an image";
  const peekStatus =
    loading && !showEditor
      ? "Loading activity…"
      : generating
        ? `Submitting… ${elapsed}s`
        : launchMode
            ? `${launchThemeLabel} · full track`
            : showEditor
                ? `${formatKm(croppedKm)}${!routeOnly && labelCount ? ` · ${labelCount} label${labelCount === 1 ? "" : "s"}` : ""}`
                : "";

  const sheetDrag = useRef<{ y: number; snap: PosterSheetSnap } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sheetMode || !onSheetHeightChange) return;
    const el = panelRef.current;
    if (!el) return;
    const notify = () => onSheetHeightChange(el.getBoundingClientRect().height);
    notify();
    const observer = new ResizeObserver(notify);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sheetMode, sheetSnap, onSheetHeightChange, showEditor, loading, error, workflowStep, mobileSurface]);

  useEffect(() => {
    if (!sheetMode || launchMode) return;
    if (workflowSteps.some((step) => step.id === workflowStep)) return;
    setWorkflowStep(workflowSteps[0]?.id ?? "crop");
  }, [sheetMode, launchMode, workflowStep, workflowSteps]);

  useEffect(() => {
    if (!sheetMode) return;
    const allowed = styleIds.filter((id) => id !== "custom");
    const keepId = allowed.includes(activeStyleId) ? activeStyleId : allowed[0];
    if (styleIds.length === (keepId ? 1 : 0) && styleIds[0] === keepId) return;
    for (const id of styleIds) {
      if (id === keepId) continue;
      for (const paletteId of paletteIdsForStyle(styleById(id), paletteIdsByStyle[id])) {
        dropSlot(id, paletteId);
      }
    }
    if (!keepId) {
      setStyleIds([]);
      setPaletteIdsByStyle({});
      setActiveStyleId("");
      setActivePlanKey("");
      return;
    }
    const palettes = paletteIdsForStyle(styleById(keepId), paletteIdsByStyle[keepId]).slice(0, 1);
    setStyleIds([keepId]);
    setPaletteIdsByStyle({ [keepId]: palettes });
    setActiveStyleId(keepId);
    setActivePlanKey(planSlotKey(keepId, palettes[0]));
  }, [sheetMode]);

  function selectWorkflowStep(id: PosterWorkflowStep) {
    setWorkflowStep(id);
    if (!onSheetSnapChange) return;
    if (MAP_WORKFLOW_STEPS.has(id)) {
      if (sheetSnap !== "half") onSheetSnapChange("half");
    } else if (sheetSnap !== "full") {
      onSheetSnapChange("full");
    }
  }

  function workflowPane(step: PosterWorkflowStep) {
    if (!sheetMode) return "";
    return `poster-workflow-pane${workflowStep === step ? " is-active" : ""}`;
  }

  function nudgeSheet(delta: number) {
    if (!sheetSnap || !onSheetSnapChange) return;
    const index = SHEET_ORDER.indexOf(sheetSnap);
    const next = SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, index + delta))];
    if (next && next !== sheetSnap) onSheetSnapChange(next);
  }

  function onSheetPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!sheetSnap) return;
    sheetDrag.current = { y: event.clientY, snap: sheetSnap };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onSheetPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    sheetDrag.current = null;
    if (!drag || !onSheetSnapChange) return;
    const dy = drag.y - event.clientY;
    if (Math.abs(dy) < 10) {
      nudgeSheet(sheetSnap === "full" ? -1 : 1);
      return;
    }
    if (dy > 48) nudgeSheet(1);
    else if (dy < -48) nudgeSheet(-1);
  }

  return (
    <>
    <aside
      ref={panelRef}
      className={`panel poster-panel${sheetMode ? " is-sheet" : ""}`}
      data-sheet={sheetSnap ?? undefined}
      aria-busy={busy || undefined}
    >
      {sheetMode ? (
        <div className="poster-sheet-chrome">
          <button
            type="button"
            className="poster-sheet-handle"
            aria-label="Resize image editor"
            onPointerDown={onSheetPointerDown}
            onPointerUp={onSheetPointerUp}
          >
            <span />
          </button>
          <div className="poster-sheet-peek">
            <div className="poster-sheet-peek-text">
              <strong>{panelTitle}</strong>
              {peekStatus ? (
                <p className="muted feature-query-block">
                  {loading && !showEditor ? <span className="spinner" aria-hidden="true" /> : null}
                  {peekStatus}
                </p>
              ) : null}
            </div>
          </div>
          {showEditor && context && sheetSnap !== "peek" && !launchMode && (
            <nav className="poster-workflow-nav" aria-label="Image creation steps">
              {workflowSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={workflowStep === step.id ? "on" : undefined}
                  aria-current={workflowStep === step.id ? "step" : undefined}
                  disabled={busy}
                  onClick={() => selectWorkflowStep(step.id)}
                >
                  {step.label}
                  {step.beta ? <span className="beta-mark">Beta</span> : null}
                </button>
              ))}
            </nav>
          )}
        </div>
      ) : (
        <div className="panel-block poster-head">
          <div>
            <div className="eyebrow">Composer</div>
            <strong>{panelTitle}</strong>
          </div>
          <button type="button" className="text-btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {loading && !showEditor && (
        <div className="panel-block sheet-from-half">
          <p className="muted feature-query-block">
            <span className="spinner" aria-hidden="true" />
            Loading activity…
          </p>
        </div>
      )}
      {error && (
        <div className="panel-block sheet-from-half">
          <p className="error">{error}</p>
        </div>
      )}
      {showEditor && context && launchMode && sheetSnap !== "peek" && (
        <div className="panel-block poster-launch sheet-from-half">
          <fieldset className="poster-editor-fieldset" disabled={busy}>
            <p className="muted poster-launch-summary">
              {formatKm(croppedKm)} · annotations off
            </p>
            {themeExamples}
            <div className="poster-option-row">
              <label className="poster-field">
                Theme
                <select
                  value={styleIds[0] ?? ""}
                  disabled={busy}
                  onChange={(event) => selectStyle(event.target.value)}
                >
                  <option value="">Select a theme</option>
                  {THEME_GROUPS.map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {group.styles.map((style) => (
                        <option key={style.id} value={style.id}>{style.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {paletteStyles[0] ? (
                <label className="poster-field">
                  Palette
                  <select
                    value={paletteIdsForStyle(paletteStyles[0], paletteIdsByStyle[paletteStyles[0].id])[0]}
                    disabled={busy}
                    onChange={(event) => selectPalette(paletteStyles[0].id, event.target.value)}
                  >
                    {paletteChoices(paletteStyles[0]).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </fieldset>
          <div className="poster-actions poster-launch-actions">
            <button
              className="button"
              type="button"
              disabled={busy || !geographyScene || !title.trim() || !styleIds.length}
              onClick={() => void handlePlanAndGenerate()}
            >
              {generating
                  ? `Submitting… ${elapsed}s`
                  : "Create image"}
            </button>
            <button
              className="text-btn"
              type="button"
              disabled={busy}
              onClick={openCustomize}
            >
              Customize
            </button>
          </div>
          {planDisabledHint ? <p className="muted">{planDisabledHint}</p> : null}
        </div>
      )}
      {showEditor && context && !launchMode && (
        <>
        <fieldset className="poster-body poster-editor-fieldset" disabled={busy}>
          {refineFrom ? (
            <div className="panel-block sheet-from-half">
              <p className="muted">
                Setup restored. Adjust and generate a new image.
              </p>
            </div>
          ) : null}
          <PosterSection
            title="Crop track"
            accordion={!sheetMode}
            open
            showTitle={!sheetMode}
            className={workflowPane("crop")}
          >
            {sheetMode ? (
              <CropRangeSlider
                start={cropStart}
                end={cropEnd}
                max={lastIndex}
                stops={stopIndexes}
                onChange={applyCrop}
              />
            ) : (
              <>
                <label className="poster-crop-row">
                  <span>Start</span>
                  <input
                    type="range"
                    min={0}
                    max={lastIndex - 1}
                    list="poster-crop-stops"
                    value={cropStart}
                    onChange={(event) => applyCrop(Number(event.target.value), cropEnd)}
                  />
                </label>
                <label className="poster-crop-row">
                  <span>End</span>
                  <input
                    type="range"
                    min={1}
                    max={lastIndex}
                    list="poster-crop-stops"
                    value={cropEnd}
                    onChange={(event) => applyCrop(cropStart, Number(event.target.value))}
                  />
                </label>
                <datalist id="poster-crop-stops">
                  {stopIndexes.map((index) => (
                    <option key={index} value={index} />
                  ))}
                </datalist>
              </>
            )}
            <p className={`muted${sheetMode ? " poster-crop-meta" : ""}`}>
              {formatKm(croppedKm)}
              {stopIndexes.length
                ? ` · snaps to ${stopIndexes.length} pause${stopIndexes.length === 1 ? "" : "s"}`
                : ""}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={showRouteMarkers}
                onChange={(event) => setShowRouteMarkers(event.target.checked)}
              />
              Start / finish markers
            </label>
            <div className="poster-place-fields">
              {samePlace ? (
                <input
                  className="search"
                  value={startPlace}
                  aria-label="Start / finish location"
                  placeholder="Start / finish location"
                  onChange={(event) => {
                    const value = event.target.value;
                    setPlacesEdited(true);
                    setStartPlace(value);
                    setFinishPlace(value);
                  }}
                />
              ) : (
                <>
                  <input
                    className="search"
                    value={startPlace}
                    aria-label="Start location"
                    placeholder="Start location"
                    onChange={(event) => {
                      setPlacesEdited(true);
                      setStartPlace(event.target.value);
                    }}
                  />
                  <input
                    className="search"
                    value={finishPlace}
                    aria-label="Finish location"
                    placeholder="Finish location"
                    onChange={(event) => {
                      setPlacesEdited(true);
                      setFinishPlace(event.target.value);
                    }}
                  />
                </>
              )}
            </div>
            {showRouteMarkers && <p className="muted">
              {isClosedLoop(croppedLatLng, croppedRouteBreaks)
                ? "One shared start / finish marker."
                : "Green start · black finish."}
            </p>}
          </PosterSection>

          <PosterSection
            title="Geography"
            accordion={!sheetMode}
            showTitle={!sheetMode}
            className={workflowPane("geography")}
            hint={featuresRefreshing ? <FeatureQueryHint label="Preparing map detail…" /> : undefined}
          >
            <p className="muted">{geographyMode === "auto" ? <>
              Map detail adapts to the poster scale.
              {geographyScene && <> Scale: <strong>{geographyScene.profile.charAt(0).toUpperCase() + geographyScene.profile.slice(1)}</strong>.</>}
            </> : "Choose map layers."}</p>
            {geographyScene?.source === "natural-earth" && <p className="muted">Overview map: small local features may be missing.</p>}
            {geographyPending && <p role="status" className="muted">Preparing map detail…</p>}
            {geographyError && <p role="alert">{geographyError} <button type="button" className="text-btn" onClick={() => setGeographyRetry(n => n + 1)}>Retry</button></p>}
            {geographyScene?.warnings.length ? <p role="status" className="muted">
              {geographyScene.warnings.join(" · ")}
              {geographyScene.completeness === "fallback" && <> <button type="button" className="text-btn" onClick={() => {
                setGeographyResult(null);
                setGeographyRetry(n => n + 1);
              }}>Retry detailed map</button></>}
            </p> : null}
            {geographyScene && <p className="muted">
              Overpass query results: {geographyScene.queryResponseBytes === undefined
                ? geographyScene.completeness === "generalized" ? "not queried" : "unavailable"
                : formatDataSize(geographyScene.queryResponseBytes)}
              {" · "}API to browser: {geographyScene.apiResponseBytes === undefined ? "unavailable" : formatDataSize(geographyScene.apiResponseBytes)}
              {" (uncompressed JSON)"}
            </p>}
            <details open={geographyMode === "manual" || undefined}>
              <summary>Advanced geography</summary>
              <label className="check"><input type="checkbox" checked={geographyMode === "auto"} onChange={event => setGeographyMode(event.target.checked ? "auto" : "manual")} />Choose map detail automatically</label>
              {geographyMode === "manual" && <button type="button" className="text-btn" onClick={() => setGeographyMode("auto")}>Reset to automatic</button>}
              {geographyMode === "auto" ? (
                <>
                  <p className="muted">Wide maps use simplified detail. Extent sets the map boundary.</p>
                  {geographyAllowance && <p className="muted" role="status">
                    This filter allows: {geographyAllowance.categories.join(", ")}. {geographyAllowance.detail}
                  </p>}
                </>
              ) : (
                <div className="poster-geo-grid">
                  {catalog
                    .filter((item) => item.group === "geography")
                    .map((item) => (
                      <label key={item.id} className="check">
                        <input
                          type="checkbox"
                          checked={featureIds.includes(item.id)}
                          onChange={() => toggleFeature(item.id)}
                        />
                        {item.label}
                      </label>
                    ))}
                </div>
              )}
            </details>
            <label className="poster-field">
              Extent
              <select
                aria-label="Background geography"
                value={geoScope}
                onChange={(event) => {
                  const id = event.target.value as GeoScope;
                  setGeoScope(id);
                  if (id === "rectangle") setRectAnchor(null);
                  if (id === "polygon" || id === "rectangle" || id === "box" || id === "hull" || id === "loop") {
                    onNeedSchematic?.();
                  }
                }}
              >
                {GEO_SCOPES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              {geoScope === "loop" && croppedLatLng.length >= 2 && !shapeRing
                ? "Requires a closed route."
                : GEO_SCOPES.find((item) => item.id === geoScope)?.hint}
            </p>
            {geoScope !== "all" &&
              croppedLatLng.length >= 2 &&
              (geoScope === "corridor" || geoScope === "ends" || (shapeRing?.length ?? 0) >= 3) && (
              <p className="muted">
                Map and satellite extend {formatCorridorM(outerExpandM(croppedLatLng))} beyond this boundary.
              </p>
            )}
            {(geoScope === "corridor" || geoScope === "ends") && context?.corridor && corridorMeters != null && (
              <label className="corridor-range">
                <span className="corridor-range-label">
                  <span>{geoScope === "ends" ? "Middle of the route" : "Around the route"}</span>
                  <span>
                    {formatCorridorM(corridorMeters)}
                    {geoScope === "ends" ? ` · ends ${formatCorridorM(endRadiusM(corridorMeters))}` : ""}
                  </span>
                </span>
                <input
                  type="range"
                  min={context.corridor.minM}
                  max={context.corridor.maxM}
                  step={50}
                  value={corridorMeters}
                  onChange={(event) => setCorridorOverride(Number(event.target.value))}
                />
              </label>
            )}
            {(geoScope === "polygon" || geoScope === "rectangle") && (
              <div className="geo-polygon-actions">
                <button
                  type="button"
                  className="text-btn"
                  disabled={activeOutline.past.length === 0}
                  onClick={() => (geoScope === "polygon" ? setPolygon(undoOutline) : setRectangle(undoOutline))}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={activeOutline.future.length === 0}
                  onClick={() => (geoScope === "polygon" ? setPolygon(redoOutline) : setRectangle(redoOutline))}
                >
                  Redo
                </button>
                {geoScope === "polygon" && (
                  <button
                    type="button"
                    className="text-btn"
                    disabled={polygon.selected == null}
                    onClick={() => setPolygon((state) => (state.selected == null ? state : removeOutlinePoint(state, state.selected)))}
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  className="text-btn"
                  disabled={activeOutline.points.length === 0 && rectAnchor == null}
                  onClick={() => {
                    if (geoScope === "polygon") setPolygon((state) => commitOutline(state, [], null));
                    else {
                      setRectAnchor(null);
                      setRectangle((state) => commitOutline(state, [], null));
                    }
                  }}
                >
                  Clear
                </button>
                <span className="muted">
                  {geoScope === "polygon"
                    ? polygon.points.length < 3
                      ? `${polygon.points.length} of 3 points`
                      : polygon.selected == null
                        ? `${polygon.points.length} points`
                        : `Point ${polygon.selected + 1} selected`
                    : rectAnchor
                      ? "Click the opposite corner"
                      : rectangle.points.length >= 4
                        ? "Drag a corner to resize"
                        : "Click the first corner"}
                </span>
              </div>
            )}
          </PosterSection>

          {showOnMapStep && (
            <PosterSection
              title="On map"
              accordion={!sheetMode}
              open
              showTitle={!sheetMode}
              className={workflowPane("on-map")}
            >
              <div className="chip-row">
                {selectedNamedAreas.map((area) => (
                  <LandmarkChip
                    key={`area-${area.name}`}
                    kind="area"
                    name={area.name}
                    label={`${area.letter} ${area.name}`}
                    title={`Wash ${area.letter} on the schematic`}
                    selected={selectedChip?.kind === "area" && selectedChip.name === area.name}
                    touchUi={touchUi}
                    onSelect={() => {
                      setSelectedChip({ kind: "area", name: area.name });
                      onHighlightChange?.({ kind: "area", name: area.name });
                    }}
                    onRemove={() => {
                      removeArea(area.name);
                      setSelectedChip(null);
                    }}
                    onHighlightChange={onHighlightChange}
                  />
                ))}
                {selectedNamedWays.map((trail) => (
                  <TrailChip
                    key={`trail-${trailSourceName(trail.name, trailAliases)}`}
                    trail={trail}
                    editing={editingTrail === trail.name}
                    draft={editingTrail === trail.name ? editingTrailName : trail.name}
                    selected={selectedChip?.kind === "trail" && selectedChip.name === trail.name}
                    touchUi={touchUi}
                    onSelect={() => {
                      setSelectedChip({ kind: "trail", name: trail.name });
                      onHighlightChange?.({ kind: "trail", name: trail.name });
                    }}
                    onEdit={() => {
                      setEditingTrail(trail.name);
                      setEditingTrailName(trail.name);
                    }}
                    onDraft={setEditingTrailName}
                    onSave={(value) => {
                      if (editingTrail !== trail.name) return;
                      renameTrail(trail.name, value);
                    }}
                    onCancel={() => setEditingTrail(null)}
                    onEditExtent={() => onEditTrailExtent?.(trail.name)}
                    onRemove={() => {
                      removeTrail(trail.name);
                      setSelectedChip(null);
                    }}
                    onHighlightChange={onHighlightChange}
                  />
                ))}
                {selectedPois.map((poi, index) => (
                  <LandmarkChip
                    key={`${poi.name}-${poi.lat}`}
                    kind="poi"
                    name={poi.name}
                    label={`${index + 1} ${poi.name}`}
                    title={
                      poi.source === "user"
                        ? `Disc ${index + 1} · placed on the schematic`
                        : `Disc ${index + 1} on the schematic`
                    }
                    selected={selectedChip?.kind === "poi" && selectedChip.name === poi.name}
                    touchUi={touchUi}
                    editing={editingLandmark === poi.name}
                    draft={editingLandmark === poi.name ? editingLandmarkName : poi.name}
                    onSelect={() => {
                      setSelectedChip({ kind: "poi", name: poi.name });
                      onHighlightChange?.({ kind: "poi", name: poi.name });
                    }}
                    onEdit={() => {
                      setEditingLandmark(poi.name);
                      setEditingLandmarkName(poi.name);
                    }}
                    onDraft={setEditingLandmarkName}
                    onSave={(value) => {
                      if (editingLandmark !== poi.name) return;
                      renameLandmark(poi.name, value);
                    }}
                    onCancel={() => setEditingLandmark(null)}
                    onRemove={() => {
                      removePoi(poi.name);
                      setEditingLandmark(null);
                      setSelectedChip(null);
                    }}
                    onHighlightChange={onHighlightChange}
                  />
                ))}
              </div>
            </PosterSection>
          )}

          {!routeOnly && <PosterSection
            title="Annotations"
            beta
            accordion={!sheetMode}
            open
            showTitle={!sheetMode}
            className={workflowPane("annotations")}
            busy={featuresRefreshing}
            hint={featuresRefreshing ? <FeatureQueryHint label="Preparing map detail…" /> : undefined}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={!routeOnly}
                disabled
              />
              Annotations
            </label>
            <p className="muted">
              {routeOnly
                ? "Landmarks, named trails, and districts stay off the map."
                : "Landmarks, named trails, and districts on the map."}
            </p>
            {!routeOnly && (
              <>
                {catalog
                  .filter((item) => item.group === "landmarks")
                  .map((item) => {
                    const meters = landmarkNearValue(item.id, item.nearRouteM);
                    return (
                      <div key={item.id} className="landmark-row">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={featureIds.includes(item.id)}
                            onChange={() => toggleFeature(item.id)}
                          />
                          {item.label}
                        </label>
                        <label className="near-route">
                          <span className="sr-only">Auto-add distance for {item.label}</span>
                          <input
                            type="number"
                            min={0}
                            max={MAX_NEAR_ROUTE_M}
                            step={50}
                            value={nearDrafts[item.id] ?? meters}
                            onChange={(event) => draftLandmarkNear(item.id, event.target.value)}
                            onBlur={(event) => commitLandmarkNear(item.id, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitLandmarkNear(item.id, event.currentTarget.value);
                              }
                            }}
                          />
                          m
                        </label>
                      </div>
                    );
                  })}
                <p className="muted">
                  Auto-add landmarks within this distance.
                </p>
                {!sheetMode && (
                  <div className="chip-row">
                    {selectedNamedAreas.map((area) => (
                      <LandmarkChip
                        key={`area-${area.name}`}
                        kind="area"
                        name={area.name}
                        label={`${area.letter} ${area.name}`}
                        title={`Wash ${area.letter} on the schematic`}
                        selected={selectedChip?.kind === "area" && selectedChip.name === area.name}
                        touchUi={touchUi}
                        onSelect={() => {
                          setSelectedChip({ kind: "area", name: area.name });
                          onHighlightChange?.({ kind: "area", name: area.name });
                        }}
                        onRemove={() => {
                          removeArea(area.name);
                          setSelectedChip(null);
                        }}
                        onHighlightChange={onHighlightChange}
                      />
                    ))}
                    {selectedNamedWays.map((trail) => (
                      <TrailChip
                        key={`trail-${trailSourceName(trail.name, trailAliases)}`}
                        trail={trail}
                        editing={editingTrail === trail.name}
                        draft={editingTrail === trail.name ? editingTrailName : trail.name}
                        selected={selectedChip?.kind === "trail" && selectedChip.name === trail.name}
                        touchUi={touchUi}
                        onSelect={() => {
                          setSelectedChip({ kind: "trail", name: trail.name });
                          onHighlightChange?.({ kind: "trail", name: trail.name });
                        }}
                        onEdit={() => {
                          setEditingTrail(trail.name);
                          setEditingTrailName(trail.name);
                        }}
                        onDraft={setEditingTrailName}
                        onSave={(value) => {
                          if (editingTrail !== trail.name) return;
                          renameTrail(trail.name, value);
                        }}
                        onCancel={() => setEditingTrail(null)}
                        onEditExtent={() => onEditTrailExtent?.(trail.name)}
                        onRemove={() => {
                          removeTrail(trail.name);
                          setSelectedChip(null);
                        }}
                        onHighlightChange={onHighlightChange}
                      />
                    ))}
                    {selectedPois.map((poi, index) => (
                      <LandmarkChip
                        key={`${poi.name}-${poi.lat}`}
                        kind="poi"
                        name={poi.name}
                        label={`${index + 1} ${poi.name}`}
                        title={
                          poi.source === "user"
                            ? `Disc ${index + 1} · placed on the schematic`
                            : `Disc ${index + 1} on the schematic`
                        }
                        selected={selectedChip?.kind === "poi" && selectedChip.name === poi.name}
                        touchUi={touchUi}
                        editing={editingLandmark === poi.name}
                        draft={editingLandmark === poi.name ? editingLandmarkName : poi.name}
                        onSelect={() => {
                          setSelectedChip({ kind: "poi", name: poi.name });
                          onHighlightChange?.({ kind: "poi", name: poi.name });
                        }}
                        onEdit={() => {
                          setEditingLandmark(poi.name);
                          setEditingLandmarkName(poi.name);
                        }}
                        onDraft={setEditingLandmarkName}
                        onSave={(value) => {
                          if (editingLandmark !== poi.name) return;
                          renameLandmark(poi.name, value);
                        }}
                        onCancel={() => setEditingLandmark(null)}
                        onRemove={() => {
                          removePoi(poi.name);
                          setEditingLandmark(null);
                          setSelectedChip(null);
                        }}
                        onHighlightChange={onHighlightChange}
                      />
                    ))}
                  </div>
                )}
                {(selectedPois.length > 0 || selectedNamedWays.length > 0 || selectedNamedAreas.length > 0) && (
                  <p className="muted">
                    The image uses place names; preview letters, numbers, and colors are guides only.
                  </p>
                )}
                {selectedPois.length + selectedNamedWays.length + selectedNamedAreas.length > MAX_LABELS && (
                  <p className="warn">
                    {selectedPois.length + selectedNamedWays.length + selectedNamedAreas.length} labels
                    selected. Image models often drop, merge, or misspell names past {MAX_LABELS}.
                  </p>
                )}
                <form className="poster-lookup" onSubmit={(event) => void handleLookup(event)}>
                  <input
                    className="search"
                    value={landmarkQuery}
                    onChange={(event) => setLandmarkQuery(event.target.value)}
                    placeholder="Search OSM for a landmark"
                    disabled={lookingUp}
                  />
                  <button className="text-btn" type="submit" disabled={lookingUp || !landmarkQuery.trim()}>
                    {lookingUp ? "Looking up…" : "Add"}
                  </button>
                </form>
                <p className="muted">
                  Use the map’s label tools to add places or trail stretches. Drag landmarks to move; click names to rename.
                </p>
                {landmarkHint && <p className="muted">{landmarkHint}</p>}
                {landmarkChoices?.map((poi) => (
                  <button key={`${poi.name}-${poi.lat}`} type="button" className="chip" onClick={() => addCustom(poi)}>
                    {poi.name}
                  </button>
                ))}
              </>
            )}
          </PosterSection>}

          <PosterSection
            title="Stats on image"
            accordion={!sheetMode}
            open
            showTitle={!sheetMode}
            className={workflowPane("stats")}
          >
            <div className="poster-unit-toggle" role="group" aria-label="Units">
              <span className="poster-unit-label">Units</span>
              <div className="poster-unit-options">
                <label className="check">
                  <input type="radio" name="poster-stat-units" value="metric" disabled={busy} checked={statUnits === "metric"} onChange={() => { setStatUnits("metric"); setDistanceDraft(null); }} />
                  Metric
                </label>
                <label className="check">
                  <input type="radio" name="poster-stat-units" value="imperial" disabled={busy} checked={statUnits === "imperial"} onChange={() => { setStatUnits("imperial"); setDistanceDraft(null); }} />
                  Imperial
                </label>
              </div>
            </div>
            {listedStats.map((stat) => stat.id === "distance" ? (
              <div key={stat.id} className="poster-stat-edit-row">
                <label className="check">
                  <input type="checkbox" checked={statIds.includes(stat.id)} disabled={busy} onChange={(event) => setStatIds(current => event.target.checked ? [...current, stat.id] : current.filter(id => id !== stat.id))} />
                  Distance
                </label>
                <input className="search" type="number" min="0" step="0.1" aria-label="Display distance" disabled={busy}
                  value={distanceDraft ?? Number.parseFloat(stat.value).toFixed(1)}
                  onChange={(event) => {
                    setDistanceDraft(event.target.value);
                    const meters = distanceToMeters(event.target.valueAsNumber, statUnits);
                    if (meters !== null) setDistanceOverrideMeters(meters);
                  }}
                  onBlur={() => setDistanceDraft(null)} />
                <span>{statUnits === "imperial" ? "mi" : "km"}</span>
                {distanceOverrideMeters !== null && <button type="button" className="chip" aria-label="Use recorded distance" title="Use recorded distance" disabled={busy} onClick={() => { setDistanceOverrideMeters(null); setDistanceDraft(null); }}>↺</button>}
              </div>
            ) : stat.id === "title" || stat.id === "date" || stat.id === "sport" || stat.id === "location" ? (
              <div key={stat.id} className="poster-stat-edit-row">
                <label className="check">
                  <input type="checkbox" checked={statIds.includes(stat.id)} disabled={busy} onChange={(event) => setStatIds(current => event.target.checked ? [...current, stat.id] : current.filter(id => id !== stat.id))} />
                  {stat.label}
                </label>
                <input className="search" aria-label={stat.id === "location" && locationMode === "coordinates" ? "Display coordinates" : `Display ${stat.id}`}
                  value={stat.value} maxLength={stat.id === "location" ? 200 : stat.id === "title" ? undefined : 80} disabled={busy}
                  readOnly={stat.id === "location" && locationMode === "coordinates"}
                  placeholder={stat.id === "location" ? locationMode === "coordinates" ? "Coordinates unavailable" : "City · Region · Country" : undefined}
                  onChange={(event) => stat.id === "title" ? setTitle(event.target.value) : stat.id === "date" ? setDateOverride(event.target.value) : stat.id === "sport" ? setSportOverride(event.target.value) : setLocationOverride(event.target.value)} />
              </div>
            ) : (
              <label key={stat.id} className="check">
                <input
                  type="checkbox"
                  checked={statIds.includes(stat.id)}
                  onChange={() =>
                    setStatIds((current) =>
                      current.includes(stat.id)
                        ? current.filter((id) => id !== stat.id)
                        : [...current, stat.id],
                    )
                  }
                />
                {stat.label}
                {stat.value ? ` — ${stat.value}` : ""}
              </label>
            ))}
            <div className="chip-row" role="group" aria-label="Location format">
              <button type="button" className={`chip ${locationMode === "place" ? "on" : ""}`} aria-pressed={locationMode === "place"} disabled={busy} onClick={() => setLocationMode("place")}>Place name</button>
              <button type="button" className={`chip ${locationMode === "coordinates" ? "on" : ""}`} aria-pressed={locationMode === "coordinates"} disabled={busy} onClick={() => setLocationMode("coordinates")}>Coordinates</button>
            </div>
            {locationMode === "coordinates" && <p className="muted">Coordinates of the selected route’s midpoint.</p>}
            {locationMode === "place" && locationOverride === null && locationStatus && <p className="muted">{locationStatus}</p>}
            {locationMode === "place" && locationOverride !== null && <button type="button" className="chip" onClick={() => setLocationOverride(null)}>Use suggested location</button>}
            <label className="check">
              <input type="checkbox" checked={peopleEnabled} disabled={busy} onChange={(event) => setPeopleEnabled(event.target.checked)} />
              Include people on image
            </label>
            <label className="poster-field">
              People (optional)
              <textarea
                rows={2}
                value={people}
                maxLength={PEOPLE_INPUT_MAX}
                disabled={busy || !peopleEnabled}
                placeholder="Alex, Jordan, Sam"
                aria-label="People who did this activity"
                aria-describedby="poster-people-help"
                onChange={(event) => setPeople(event.target.value)}
              />
            </label>
            <p id="poster-people-help" className="muted">Enter a comma-separated list of names.</p>
            {peopleEnabled && people && <button type="button" className="text-btn" disabled={busy} onClick={() => setPeople("")}>Clear people</button>}
            <p className="muted" aria-label="Current stats">{posterStats.map(stat => stat.label === "With" ? `With ${stat.value}` : stat.value).filter(Boolean).join(" · ") || "No stats selected"}</p>
          </PosterSection>

          <PosterSection
            title="Themes"
            accordion={!sheetMode}
            open
            showTitle={!sheetMode}
            className={workflowPane("themes")}
            hint={!sheetMode ? themeExamples : undefined}
          >
            {sheetMode && themeExamples}
            {sheetMode ? (
              <div className="poster-option-row">
                <label className="poster-field">
                  Theme
                  <select
                    value={styleIds[0] ?? ""}
                    disabled={busy}
                    onChange={(event) => selectStyle(event.target.value)}
                  >
                    <option value="">Select a theme</option>
                    {THEME_GROUPS.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.styles.map((style) => (
                          <option key={style.id} value={style.id}>{style.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {paletteStyles[0] ? (
                  <label className="poster-field">
                    Palette
                    <select
                      value={paletteIdsForStyle(paletteStyles[0], paletteIdsByStyle[paletteStyles[0].id])[0]}
                      disabled={busy}
                      onChange={(event) => selectPalette(paletteStyles[0].id, event.target.value)}
                    >
                      {paletteChoices(paletteStyles[0]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : (
              <>
                <div className="theme-selection-groups">
                  {THEME_GROUPS.map((group) => (
                    <div key={group.id} role="group" aria-labelledby={`theme-group-${group.id}`}>
                      <div id={`theme-group-${group.id}`} className="subheading">{group.label}</div>
                      <div className="theme-card-grid">
                        {group.styles.map((style) => {
                          const active = styleIds.includes(style.id);
                          const hasPalettes = showsPalettePicker(style);
                          const selected = paletteIdsForStyle(style, paletteIdsByStyle[style.id]);
                          return <div key={style.id} className={`theme-choice-card${active ? " is-selected" : ""}${active && hasPalettes ? " is-expanded" : ""}`}>
                            <button
                              type="button"
                              className="theme-choice-card-header"
                              aria-pressed={active}
                              aria-expanded={hasPalettes ? active : undefined}
                              aria-controls={hasPalettes && active ? `theme-card-palettes-${style.id}` : undefined}
                              onClick={() => toggleStyle(style.id)}
                            >
                              <span>{style.label}</span>
                              <span aria-hidden="true">{active ? "✓" : "+"}</span>
                            </button>
                            {active && hasPalettes && <div id={`theme-card-palettes-${style.id}`} className="theme-choice-card-body">
                              <div className="subheading">Palette</div>
                              <div className="selected-theme-palettes" role="group" aria-label={`${style.label} palettes`}>
                                {paletteChoices(style).map((item) => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={`chip ${selected.includes(item.id) ? "on" : ""}`}
                                    aria-pressed={selected.includes(item.id)}
                                    onClick={() => togglePalette(style.id, item.id)}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>}
                          </div>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {planSlots.length > 1 && <p className="muted">
                  {`${planSlots.length} images — one per theme and palette`}
                </p>}
              </>
            )}
            {!sheetMode && editingCustom && (
              <textarea
                className="poster-prompt"
                rows={5}
                value={stylePrompt}
                onChange={(event) => setStylePrompt(event.target.value)}
                placeholder="Custom style prompt"
              />
            )}
            {!sheetMode && styleIds.length > 1 && editingCustom && (
              <p className="muted">Custom uses this prompt; other themes use their presets.</p>
            )}
            <label className="poster-field">
              Vibes (optional)
              <textarea
                rows={3}
                value={vibes}
                maxLength={500}
                disabled={busy}
                placeholder="Crisp fall day, golden leaves…"
                onChange={(event) => setVibes(event.target.value)}
              />
            </label>
            {sheetMode && !styleIds.length ? <p className="muted">Select a theme to generate</p> : null}
            {sheetMode && (
              <div className="poster-actions poster-plan-row">
                <button
                  className="button"
                  type="button"
                  disabled={busy || !geographyScene || !title.trim() || !styleIds.length}
                  onClick={() => void handlePlanAndGenerate()}
                >
                  {generating ? `Submitting… ${elapsed}s` : "Generate image"}
                </button>
                {planDisabledHint ? <p className="muted">{planDisabledHint}</p> : null}
              </div>
            )}
          </PosterSection>

        </fieldset>
          {!sheetMode && (
            <footer className="poster-footer" aria-label="Generate image">
              {context.warnings.length ? <p className="muted">{context.warnings.join(" · ")}</p> : null}
              <div className="poster-actions poster-plan-row">
                <button
                  className="button"
                  type="button"
                  disabled={busy || !geographyScene || !title.trim() || !styleIds.length}
                  onClick={() => void handlePlanAndGenerate()}
                >
                  {generating
                    ? `Submitting… ${elapsed}s`
                    : generateCount > 1
                        ? planSlots.length > 1
                          ? `Generate ${planSlots.length} images (${generateCount} variants)`
                          : `Generate ${generateCount} variants`
                        : "Generate image"}
                </button>
                {planDisabledHint ? <p className="muted">{planDisabledHint}</p> : null}
              </div>

            </footer>
          )}
        </>
      )}
    </aside>
    </>
  );
}
