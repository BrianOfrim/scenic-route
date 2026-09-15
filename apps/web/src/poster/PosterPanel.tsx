import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  fetchMaxReferences,
  fetchPosterCapabilities,
  fetchPosterContext,
  formatKm,
  generatePoster,
  lookupPosterLandmark,
  planPoster,
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
import { clampCrop, isClosedLoop, isNearCroppedRoute, paddedBbox, schematicBbox, shiftRouteSpans, sliceTrack, snapIndex, snapRadius, trackDistanceM } from "./crop";
import {
  FEATURE_CATALOG,
  DEFAULT_FEATURE_IDS,
  MAX_NEAR_ROUTE_M,
  clampNearRouteM,
  defaultLandmarkNearM,
  encodeFeatureQuery,
  nearRouteMForKind,
  type FeatureOption,
} from "./featureCatalog";
import { planContactSheets, renderContactSheets, type GroundingLayer } from "./grounding/contactSheet";
import {
  renderSchematicDataUrl,
  schematicLayersFromFeatureIds,
  type AspectRatio,
} from "./grounding/renderSchematic";
import { snapshotTiles } from "./grounding/snapshotTiles";
import { applyTrailAlias, nextTrailAliases, relocateLandmark, trailSourceName, userLandmark, userNamedWay } from "./annotate";
import {
  asAspectRatio,
  captureEditorSnapshot,
  editorSeed,
  restoreEditor,
  styleIdFromRecord,
} from "./editorSnapshot";
import { addedFeatureIds, forgetDismissedForLayers, takeFreshNames } from "./autoNames";
import { MAX_LABELS, prioritizeLabels } from "./labels";
import { nearestPlaceName } from "./places";
import { assignAreaLetters } from "./areaLetters";
import { assignTrailColors } from "./trailColors";
import { SpecEditor } from "./SpecEditor";
import {
  MAX_VARIANTS,
  formatBatchCost,
  formatCostBreakdown,
  formatDurationMs,
  posterVariantLabel,
  readStoredVariants,
  shortModelLabel,
  sumCosts,
  variantCount,
  writeStoredVariants,
} from "./imageModels";

import { BatchCompare, defaultComparePair, type CompareImage } from "../compare/BatchCompare";
import { ShareButton } from "../share";
import {
  AUTO_PALETTE_ID,
  DEFAULT_POSTER_STYLE,
  POSTER_STYLES,
  paletteIdsForStyle,
  parsePlanSlotKey,
  planSlotKey,
  planSlotLabel,
  resolveStyleColor,
  showsPalettePicker,
  specForSlot,
  styleById,
  stylePalettes,
  stylePlanSlots,
} from "./styles";

type GenerationRun = {
  key: string;
  styleId: string;
  paletteId: string;
  styleLabel: string;
  model: string;
  label: string;
  startedAt: number;
  finishedAt?: number;
  promptCost?: number | null;
  imageCost?: number | null;
  error?: string;
};


const ASPECTS: AspectRatio[] = ["2:3", "3:4", "1:1", "4:3", "16:9"];
const EMPTY_POIS: PosterPoi[] = [];
const EMPTY_WAYS: NamedWay[] = [];
const EMPTY_AREAS: NamedArea[] = [];

const SCHEMATIC_LEGEND =
  "red = unnamed GPS track; colored route stretches = named trails, private color index, do not copy onto the poster; grey = roads; blue = water; green = forest; ochre wash + letter = named district, private region index, copy the footprint not the ochre or letter; numbered discs = private location index, do not copy";

const GEOGRAPHY_LEGEND = "red = GPS track; grey = roads; blue = water; green = forest/parks";

const ROUTE_ONLY_LEGEND = "red = GPS track";

const SATELLITE_LEGEND =
  "real aerial imagery of the same frame; red = GPS track; use for land cover, water, vegetation, and built form; every red stroke is a required segment; do not copy the photograph";


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
  onSelect,
  onRemove,
  onHighlightChange,
}: {
  kind: "area" | "poi";
  name: string;
  label: string;
  title: string;
  selected: boolean;
  touchUi: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void;
}) {
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

function GroundingThumb({
  src,
  label,
  onOpen,
}: {
  src: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <figure className="poster-ref-card">
      <button type="button" className="poster-ref-open" onClick={onOpen} aria-label={`Enlarge ${label}`}>
        <img className="poster-ref" src={src} alt={`${label} grounding`} />
      </button>
      <figcaption>{label}</figcaption>
    </figure>
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
  satelliteUrl: string | null,
  maxRefs: number,
  latlng: [number, number][],
  showMarkers: boolean,
  annotations = true,
  hasGeography = false,
): GroundingLayer[] {
  if (!schematicUrl) return [];
  const layers: GroundingLayer[] = [
    {
      role: "schematic",
      legend: schematicLegend(routeMarkerMode(showMarkers, latlng), annotations, hasGeography),
      dataUrl: schematicUrl,
    },
  ];
  if (maxRefs >= 2 && satelliteUrl) {
    layers.push({
      role: "satellite",
      legend: SATELLITE_LEGEND,
      dataUrl: satelliteUrl,
    });
  }
  return layers;
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

function PosterSection({
  title,
  accordion,
  children,
  className = "",
  hint,
  open,
  busy,
  showTitle = true,
}: {
  title: string;
  accordion: boolean;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
  open?: boolean;
  busy?: boolean;
  showTitle?: boolean;
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
            <span className="eyebrow">{title}</span>
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
            <div className="eyebrow">{title}</div>
            {hint}
          </div>
        ) : (
          <div className="eyebrow">{title}</div>
        )
      ) : (
        hint
      )}
      {children}
    </div>
  );
}

function sentRefsHint(maxRefs: number, hasSatellite: boolean, satellitePending: boolean) {
  const parts = ["schematic"];
  if (maxRefs >= 2) {
    if (hasSatellite) parts.push("satellite");
    else if (satellitePending) parts.push("satellite (loading)");
  }
  if (parts.length === 1) return "1 schematic reference will be sent. Click the preview to enlarge.";
  return `${parts.length} references will be sent: ${parts.join(" + ")}. Click a preview to enlarge.`;
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
  | "output"
  | "prompt"
  | "result";

const MAP_WORKFLOW_STEPS = new Set<PosterWorkflowStep>(["crop", "on-map"]);

function savedModelRefs(record: PosterRecord): ModelRef[] {
  return Array.from({ length: record.referenceCount }, (_, index) => ({
    role: `reference ${index + 1}`,
    dataUrl: `/api/posters/${record.posterId}/ref-${index + 1}.png`,
  }));
}

type Props = {
  activityId: number;
  features: FeatureOption[];
  onClose: () => void;
  onCropChange?: (crop: [number, number][] | null) => void;
  onStopsChange?: (stops: [number, number][]) => void;
  onPoisChange?: (pois: PosterPoi[]) => void;
  onNamedWaysChange?: (trails: NamedWay[]) => void;
  onNamedAreasChange?: (areas: NamedArea[]) => void;
  onWaysChange?: (ways: PosterWays | null) => void;
  onSchematicLayersChange?: (layers: ReturnType<typeof schematicLayersFromFeatureIds> | null) => void;
  onRouteOnlyChange?: (routeOnly: boolean) => void;
  refineFrom?: PosterRecord | null;
  dismissPoi?: { name: string; nonce: number } | null;
  dismissArea?: { name: string; nonce: number } | null;
  dismissTrail?: { name: string; nonce: number } | null;
  placeLandmark?: { name: string; lat: number; lng: number; nonce: number } | null;
  moveLandmark?: { name: string; lat: number; lng: number; nonce: number } | null;
  placeSection?: { name: string; start: number; end: number; nonce: number } | null;
  renameTrail?: { name: string; next: string; nonce: number } | null;
  onHighlightChange?: (highlight: { kind: "area" | "trail" | "poi"; name: string } | null) => void;
  touchUi?: boolean;
  sheetSnap?: PosterSheetSnap | null;
  onSheetSnapChange?: (snap: PosterSheetSnap) => void;
  onSheetHeightChange?: (heightPx: number) => void;
};

export function PosterPanel({
  activityId,
  features,
  onClose,
  onCropChange,
  onStopsChange,
  onPoisChange,
  onNamedWaysChange,
  onNamedAreasChange,
  onWaysChange,
  onSchematicLayersChange,
  onRouteOnlyChange,
  refineFrom,
  dismissPoi,
  dismissArea,
  dismissTrail,
  placeLandmark,
  moveLandmark,
  placeSection,
  renameTrail: renameTrailEvent,
  onHighlightChange,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    return [];
  });
  const [stylePrompt, setStylePrompt] = useState(seeded?.stylePrompt || DEFAULT_POSTER_STYLE.prompt);
  const [paletteIdsByStyle, setPaletteIdsByStyle] = useState<Record<string, string[]>>(
    () => seeded?.paletteIdsByStyle ?? {},
  );
  const [activeStyleId, setActiveStyleId] = useState(
    () => seeded?.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : ""),
  );
  const [activePlanKey, setActivePlanKey] = useState(() => {
    const id = seeded?.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : "");
    if (!id) return "";
    const paletteId = seeded?.paletteIdsByStyle?.[id]?.[0] ?? AUTO_PALETTE_ID;
    return planSlotKey(id, paletteId);
  });
  const [title, setTitle] = useState(seeded?.title ?? "");
  const [startPlace, setStartPlace] = useState("");
  const [finishPlace, setFinishPlace] = useState("");
  const [placesEdited, setPlacesEdited] = useState(false);
  const [statIds, setStatIds] = useState<string[]>(["title", "date", "distance", "movingTime"]);
  const [labels, setLabels] = useState<string[]>(() => seeded?.labels ?? []);
  const [trailNames, setTrailNames] = useState<string[]>(() => seeded?.trailNames ?? []);
  const [trailAliases, setTrailAliases] = useState<Record<string, string>>({});
  const [editingTrail, setEditingTrail] = useState<string | null>(null);
  const [editingTrailName, setEditingTrailName] = useState("");
  const [areaNames, setAreaNames] = useState<string[]>(() => seeded?.areaNames ?? []);
  const allowRefineAutoNames = useRef(false);
  const [customPois, setCustomPois] = useState<PosterPoi[]>([]);
  const [customWays, setCustomWays] = useState<NamedWay[]>([]);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const [showRouteMarkers, setShowRouteMarkers] = useState(seeded?.showRouteMarkers ?? true);
  const [routeOnly, setRouteOnly] = useState(seeded?.routeOnly ?? true);
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [landmarkChoices, setLandmarkChoices] = useState<PosterPoi[] | null>(null);
  const [landmarkHint, setLandmarkHint] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => asAspectRatio(seeded?.aspectRatio));
  const [schematicUrl, setSchematicUrl] = useState<string | null>(null);
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);
  const [, setModelRefs] = useState<ModelRef[]>([]);
  const [sentRefs, setSentRefs] = useState<ModelRef[]>([]);
  const [maxRefs, setMaxRefs] = useState(3);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const imageModelIds = imageModelId ? [imageModelId] : [];
  const [variants, setVariants] = useState(() => seeded?.variants ?? readStoredVariants());
  const [workflowStep, setWorkflowStep] = useState<PosterWorkflowStep>("crop");
  const [specs, setSpecs] = useState<Partial<Record<string, PosterSpec>>>(() => seeded?.specs ?? {});
  const [planCosts, setPlanCosts] = useState<Partial<Record<string, number | null>>>(() => seeded?.planCosts ?? {});
  const [planning, setPlanning] = useState(false);
  const [planProgress, setPlanProgress] = useState({ done: 0, total: 0 });
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });
  const [modelRuns, setModelRuns] = useState<GenerationRun[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PosterRecord | null>(() => refineFrom ?? null);
  const [batchResults, setBatchResults] = useState<PosterRecord[]>(() => (refineFrom ? [refineFrom] : []));
  const [preview, setPreview] = useState<{ src: string; label: string } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [compareFocus, setCompareFocus] = useState<"left" | "right">("right");
  const cropActivityId = useRef<number | null>(null);

  useEffect(() => {
    return () => onHighlightChange?.(null);
  }, [activityId]);
  const featureQuery = useMemo(
    () => encodeFeatureQuery(featureIds.filter((id) => id !== "named-trails"), landmarkNearM, catalog),
    [featureIds, landmarkNearM, catalog],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPosterCapabilities().then((caps) => {
      if (cancelled) return;
      setImageModels(caps.models);
      if (caps.defaultModel) setImageModelId(caps.defaultModel);
      setMaxRefs(caps.maxReferences);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!imageModelId) return;
    let cancelled = false;
    void fetchMaxReferences(imageModelId).then((value) => {
      if (!cancelled) setMaxRefs(value);
    });
    return () => {
      cancelled = true;
    };
  }, [imageModelId]);

  useEffect(() => {
    let cancelled = false;
    const activityChanged = cropActivityId.current !== activityId;
    setLoading(true);
    if (activityChanged) {
      setError(null);
    }
    fetchPosterContext(activityId, featureIds.filter((id) => id !== "named-trails"), featureQuery)
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
          setWorkflowStep(refineFrom ? "result" : "crop");
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
            setRouteOnly(restored.routeOnly);
            setTitle(restored.title);
            setStartPlace(restored.startPlace);
            setFinishPlace(restored.finishPlace);
            setPlacesEdited(restored.placesEdited);
            setStatIds(restored.statIds);
            setAspectRatio(restored.aspectRatio);
            setStyleIds(restored.styleIds);
            setStylePrompt(restored.stylePrompt);
            setPaletteIdsByStyle(restored.paletteIdsByStyle);
            const first =
              restored.styleIds[0] ?? (refineFrom ? styleIdFromRecord(refineFrom) : "");
            setActiveStyleId(first);
            setActivePlanKey(
              first
                ? planSlotKey(first, restored.paletteIdsByStyle[first]?.[0] ?? AUTO_PALETTE_ID)
                : "",
            );
            setSpecs(restored.specs);
            setPlanCosts(restored.planCosts);
            if (restored.variants != null) setVariants(restored.variants);
            setSentRefs(savedModelRefs(refineFrom));
            setResult(refineFrom);
            setBatchResults([refineFrom]);
          } else {
            dismissedAutoNames.current.pois.clear();
            dismissedAutoNames.current.trails.clear();
            dismissedAutoNames.current.areas.clear();
            allowRefineAutoNames.current = false;
            setLabels(incomingPois);
            setTrailNames(incomingTrails);
            setAreaNames(incomingAreas);
            setTitle(next.activity.name || "Ride");
            setCropStart(0);
            setCropEnd(Math.max(1, next.latlng.length - 1));
            setPlacesEdited(false);
            setStartPlace("");
            setFinishPlace("");
            setCustomPois([]);
            setCustomWays([]);
            setTrailAliases({});
            setResult(null);
            setBatchResults([]);
            setSentRefs([]);
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load poster context");
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
  const hasGeographyLayers = catalog.some(
    (item) => item.group === "geography" && featureIds.includes(item.id),
  );

  const schematicLayers = useMemo(() => {
    const layers = schematicLayersFromFeatureIds(
      featureIds,
      routeMarkerMode(showRouteMarkers, croppedLatLng),
    );
    return { ...layers, labels: !routeOnly };
  }, [featureIds, showRouteMarkers, croppedLatLng, routeOnly]);

  const displayBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return context?.bbox ?? null;
    return paddedBbox(croppedLatLng, [...posterPois, ...posterWays, ...posterAreas]);
  }, [context, croppedLatLng, posterPois, posterWays, posterAreas]);
  const groundingBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return displayBbox;
    return schematicBbox(croppedLatLng, [...posterPois, ...posterWays, ...posterAreas], landmarkNearM);
  }, [croppedLatLng, posterPois, posterWays, posterAreas, displayBbox, landmarkNearM]);

  const loopRide = useMemo(() => isClosedLoop(croppedLatLng), [croppedLatLng]);

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
    setFinishPlace(loopRide ? suggestedPlaces.start : suggestedPlaces.finish);
  }, [suggestedPlaces, loopRide, placesEdited]);

  const samePlace =
    loopRide ||
    (Boolean(startPlace.trim()) && startPlace.trim().toLowerCase() === finishPlace.trim().toLowerCase());

  const listedStats = useMemo((): FormattedStat[] => {
    const available = (context?.stats ?? []).filter((item) => item.id !== "title");
    return [{ id: "title", label: "Title", value: title }, ...available];
  }, [context, title]);

  const selectedStats = useMemo(() => {
    return listedStats.filter((item) => statIds.includes(item.id) && (item.id === "title" || item.value));
  }, [listedStats, statIds]);

  const subtitle = useMemo(() => {
    return selectedStats
      .filter((item) => item.id !== "title")
      .map((item) => item.value)
      .join(" · ");
  }, [selectedStats]);

  useEffect(() => {
    onCropChange?.(croppedLatLng.length >= 2 ? croppedLatLng : null);
  }, [croppedLatLng, onCropChange]);

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
    onWaysChange?.(context?.ways ?? null);
  }, [context, onWaysChange]);

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
    const way = userNamedWay(placeSection.name, start, end, context.latlng, displayBbox ?? context.bbox);
    if (!way) return;
    addCustomWay(way);
    setLandmarkHint(`Named “${way.name}” on the schematic`);
  }, [placeSection]);

  useEffect(() => {
    if (!renameTrailEvent?.name) return;
    renameTrail(renameTrailEvent.name, renameTrailEvent.next);
  }, [renameTrailEvent, renameTrail]);

  useEffect(
    () => () => {
      onCropChange?.(null);
      onStopsChange?.([]);
      onWaysChange?.(null);
      onSchematicLayersChange?.(null);
    },
    [onCropChange, onStopsChange, onWaysChange, onSchematicLayersChange],
  );

  useEffect(() => {
    if (croppedLatLng.length < 2 || !groundingBbox) {
      setSchematicUrl(null);
      setSatelliteUrl(null);
      return;
    }
    try {
      setSchematicUrl(
        renderSchematicDataUrl({
          latlng: croppedLatLng,
          bbox: groundingBbox,
          ways: context?.ways,
          pois: posterPois,
          namedWays: posterWays,
          namedAreas: posterAreas,
          aspectRatio,
          layers: schematicLayers,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render schematic");
    }
  }, [context, croppedLatLng, groundingBbox, posterPois, posterWays, posterAreas, aspectRatio, schematicLayers]);

  useEffect(() => {
    if (croppedLatLng.length < 2 || !groundingBbox || maxRefs < 2) {
      setSatelliteUrl(null);
      return;
    }
    let cancelled = false;
    void snapshotTiles({
      source: "satellite",
      bbox: groundingBbox,
      latlng: croppedLatLng,
      aspectRatio,
      routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng),
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
  }, [croppedLatLng, groundingBbox, aspectRatio, showRouteMarkers, maxRefs]);

  useEffect(() => {
    const layers = groundingLayers(
      schematicUrl,
      satelliteUrl,
      maxRefs,
      croppedLatLng,
      showRouteMarkers,
      !routeOnly,
      hasGeographyLayers,
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
    satelliteUrl,
    maxRefs,
    aspectRatio,
    showRouteMarkers,
    croppedLatLng,
    routeOnly,
    hasGeographyLayers,
  ]);

  useEffect(() => {
    setModelRuns([]);
  }, [activityId]);

  useEffect(() => {
    if (!generating && !planning) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [generating, planning]);

  async function ensureSatellite(): Promise<string | null> {
    if (maxRefs < 2 || croppedLatLng.length < 2 || !groundingBbox) return null;
    if (satelliteUrl) return satelliteUrl;
    try {
      return await snapshotTiles({
        source: "satellite",
        bbox: groundingBbox,
        latlng: croppedLatLng,
        aspectRatio,
        routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng),
      });
    } catch {
      return null;
    }
  }

  async function buildGrounding(): Promise<GroundingLayer[]> {
    const satellite = await ensureSatellite();
    return groundingLayers(
      schematicUrl,
      satellite,
      maxRefs,
      croppedLatLng,
      showRouteMarkers,
      !routeOnly,
      hasGeographyLayers,
    );
  }

  async function handlePlan() {
    if (!context) return;
    const slots = stylePlanSlots(styleIds, paletteIdsByStyle);
    if (!slots.length) return;
    setPlanning(true);
    setError(null);
    setPlanProgress({ done: 0, total: slots.length });
    try {
      const layers = await buildGrounding();
      const packed = planContactSheets(layers, maxRefs);
      const base = {
        activity: {
          name: context.activity.name,
          sportType: context.activity.sportType,
          isLoop: isClosedLoop(croppedLatLng),
        },
        routeMarkers: {
          enabled: showRouteMarkers,
          mode: isClosedLoop(croppedLatLng) ? "loop" as const : "start-finish" as const,
          startName: startPlace.trim() || undefined,
          finishName: (samePlace ? startPlace : finishPlace).trim() || undefined,
        },
        title,
        subtitle,
        stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
        aspectRatio,
        geography: catalog
          .filter(
            (item) =>
              (item.group === "geography" || item.id === "cemeteries") && featureIds.includes(item.id),
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
      const settled = await Promise.all(
        slots.map(async (slot) => {
          const style = styleById(slot.styleId);
          try {
            const planned = await planPoster({
              ...base,
              style: styleForPlan(style, slot.paletteId),
              customStylePrompt: style.id === "custom" ? stylePrompt : undefined,
              previousSpec:
                specForSlot(specs, slot.styleId, slot.paletteId) ??
                (refineFrom && refineFrom.styleId === slot.styleId ? refineFrom.spec : undefined),
            });
            return { ...slot, spec: planned.spec, cost: planned.cost };
          } catch (err) {
            return {
              ...slot,
              error: err instanceof Error ? err.message : "Planner failed",
              cost: null,
            };
          } finally {
            setPlanProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }),
      );
      const planned = settled.flatMap((item) =>
        "spec" in item && item.spec
          ? [{ key: item.key, styleId: item.styleId, paletteId: item.paletteId, spec: item.spec, cost: item.cost }]
          : [],
      );
      const failures = settled.flatMap((item) =>
        "error" in item && item.error ? [`${planSlotLabel(item.styleId, item.paletteId)}: ${item.error}`] : [],
      );
      if (!planned.length) throw new Error(failures.join(" · ") || "Planner failed");
      setSpecs((current) => {
        const next = { ...current };
        for (const item of planned) next[item.key] = item.spec;
        return next;
      });
      setPlanCosts((current) => {
        const next = { ...current };
        for (const item of planned) next[item.key] = item.cost ?? null;
        return next;
      });
      if (!planned.some((item) => item.key === activePlanKey)) {
        setActivePlanKey(planned[0].key);
        setActiveStyleId(planned[0].styleId);
      }
      if (failures.length) {
        setError(`${failures.length} theme${failures.length === 1 ? "" : "s"} failed to plan. ${failures.join(" · ")}`);
      }
      if (sheetSnap != null) {
        setWorkflowStep("prompt");
        onSheetSnapChange?.("full");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planner failed");
    } finally {
      setPlanning(false);
    }
  }

  async function handleGenerate() {
    if (!context) return;
    if (!imageModelIds.length) {
      setError("Set OPENROUTER_IMAGE_MODEL in .env.local, then restart the API.");
      return;
    }
    const jobs = stylePlanSlots(styleIds, paletteIdsByStyle).flatMap((slot) => {
      const planned = specForSlot(specs, slot.styleId, slot.paletteId);
      if (!planned) return [];
      const style = styleById(slot.styleId);
      return imageModelIds.map((model) => ({
        key: `${slot.key}\0${model}`,
        styleId: slot.styleId,
        paletteId: slot.paletteId,
        style,
        spec: planned,
        model,
        slotKey: slot.key,
      }));
    });
    if (!jobs.length) return;
    setGenerating(true);
    setError(null);
    try {
      const layers = await buildGrounding();
      const packed = await renderContactSheets(layers, maxRefs, aspectRatio);
      setSentRefs(packed.map((item) => ({ role: item.role, legend: item.legend, dataUrl: item.dataUrl })));
      const batchId = crypto.randomUUID();
      setGenerateProgress({ done: 0, total: jobs.length });
      const startedAt = Date.now();
      setModelRuns(
        jobs.map((job) => ({
          key: job.key,
          styleId: job.slotKey,
          paletteId: job.paletteId,
          styleLabel: planSlotLabel(job.styleId, job.paletteId),
          model: job.model,
          label: shortModelLabel(job.model, imageModels.find((item) => item.id === job.model)?.name),
          startedAt,
          promptCost: planCosts[job.slotKey] ?? specForSlot(planCosts, job.styleId, job.paletteId) ?? null,
        })),
      );
      const settled = await Promise.all(
        jobs.map(async (job) => {
          try {
            const records = await generatePoster({
              activityId,
              spec: job.spec,
              references: packed.map((item) => item.dataUrl),
              previousPosterId: refineFrom?.posterId,
              featureIds,
              labels: posterPois.map((poi) => poi.name),
              stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
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
              promptCost: planCosts[job.slotKey] ?? specForSlot(planCosts, job.styleId, job.paletteId) ?? null,
              editor: captureEditorSnapshot({
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
                startPlace,
                finishPlace,
                placesEdited,
                statIds,
                aspectRatio,
                styleIds,
                stylePrompt,
                paletteIdsByStyle,
                imageModelIds,
                variants,
                specs,
                planCosts,
              }),
            });
            setModelRuns((current) =>
              current.map((run) =>
                run.key === job.key
                  ? { ...run, finishedAt: Date.now(), imageCost: sumCosts(records.map((item) => item.cost)) }
                  : run,
              ),
            );
            return { key: job.key, styleId: job.styleId, paletteId: job.paletteId, model: job.model, records };
          } catch (err) {
            const error = err instanceof Error ? err.message : "Poster generation failed";
            setModelRuns((current) =>
              current.map((run) =>
                run.key === job.key ? { ...run, finishedAt: Date.now(), error } : run,
              ),
            );
            return { key: job.key, styleId: job.styleId, paletteId: job.paletteId, model: job.model, error };
          } finally {
            setGenerateProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }),
      );
      const records = settled.flatMap((item) => item.records ?? []);
      const failures = settled.flatMap((item) => {
        if (!item.error) return [];
        const theme = planSlotLabel(item.styleId, item.paletteId ?? AUTO_PALETTE_ID);
        const model = shortModelLabel(item.model);
        return [`${stylePlanSlots(styleIds, paletteIdsByStyle).length > 1 ? `${theme} · ` : ""}${model}: ${item.error}`];
      });
      if (!records.length) throw new Error(failures.join(" · ") || "Poster generation failed");
      setBatchResults(records);
      setResult(records[0]);
      setActiveStyleId(records[0].styleId || activeStyleId);
      if (failures.length) {
        setError(`${failures.length} poster${failures.length === 1 ? "" : "s"} failed. ${failures.join(" · ")}`);
      }
      if (sheetSnap != null) {
        setWorkflowStep("result");
        onSheetSnapChange?.("full");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Poster generation failed");
    } finally {
      setGenerating(false);
    }
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
    setCustomWays((current) =>
      current.some((item) => item.name.toLowerCase() === way.name.toLowerCase()) ? current : [...current, way],
    );
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
    setSpecs((current) => {
      if (!current[key] && !current[styleId]) return current;
      const next = { ...current };
      delete next[key];
      if (paletteId === AUTO_PALETTE_ID) delete next[styleId];
      return next;
    });
    setPlanCosts((current) => {
      if (!(key in current) && !(styleId in current)) return current;
      const next = { ...current };
      delete next[key];
      if (paletteId === AUTO_PALETTE_ID) delete next[styleId];
      return next;
    });
  }

  function togglePalette(styleId: string, paletteId: string) {
    const style = styleById(styleId);
    const current = paletteIdsForStyle(style, paletteIdsByStyle[styleId]);
    const selected = current.includes(paletteId)
      ? current.filter((item) => item !== paletteId)
      : [...current, paletteId];
    const next = selected.length ? selected : [AUTO_PALETTE_ID];
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

  function toggleStyle(id: string) {
    setStyleIds((current) => {
      if (current.includes(id)) {
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
      setActiveStyleId(id);
      if (id === "custom" && !stylePrompt) {
        const from = styleById(activeStyleId);
        if (from.prompt) setStylePrompt(from.prompt);
      }
      const palettes = paletteIdsForStyle(styleById(id), [AUTO_PALETTE_ID]);
      setPaletteIdsByStyle((map) => ({ ...map, [id]: palettes }));
      setActivePlanKey(planSlotKey(id, palettes[0]));
      return [...current, id];
    });
  }

  function applyVariants(value: number) {
    setVariants(value);
    writeStoredVariants(value);
  }

  function selectResult(record: PosterRecord) {
    setResult(record);
    if (record.styleId) {
      const paletteId = record.paletteId ?? AUTO_PALETTE_ID;
      const key = planSlotKey(record.styleId, paletteId);
      setActiveStyleId(record.styleId);
      setActivePlanKey(key);
      setSpecs((current) => ({ ...current, [record.styleId]: record.spec, [key]: record.spec }));
    }
    setSentRefs(savedModelRefs(record));
  }

  function resultSlotLabel(item: PosterRecord) {
    return planSlotLabel(item.styleId, item.paletteId ?? AUTO_PALETTE_ID, item.spec.style.name);
  }

  const showEditor = context != null && cropActivityId.current === activityId;
  const featuresRefreshing = loading && showEditor;
  const lastIndex = Math.max(1, (context?.latlng.length ?? 2) - 1);
  const croppedKm = trackDistanceM(croppedLatLng);
  const busy = planning || generating;
  const planDisabledHint = planning
    ? null
    : generating
      ? "Wait until generation finishes."
      : !styleIds.length && !title.trim()
        ? "Select a theme and add a title in Stats before planning."
        : !styleIds.length
          ? "Select a theme before planning."
          : !title.trim()
            ? "Add a title in Stats before planning."
            : null;
  const planSlots = stylePlanSlots(styleIds, paletteIdsByStyle);
  const plannedSlots = planSlots.filter((slot) => specForSlot(specs, slot.styleId, slot.paletteId));
  const specSlot = plannedSlots.find((slot) => slot.key === activePlanKey) ?? plannedSlots[0];
  const spec = specSlot ? specForSlot(specs, specSlot.styleId, specSlot.paletteId) ?? null : null;
  const allThemesPlanned = planSlots.length > 0 && plannedSlots.length === planSlots.length;
  const generateCount = plannedSlots.length * imageModelIds.reduce(
    (sum, id) => sum + variantCount(variants, imageModels.find((item) => item.id === id)?.maxImages),
    0,
  );
  const variantCaps = imageModelIds
    .map((id) => {
      const model = imageModels.find((item) => item.id === id);
      const allowed = variantCount(variants, model?.maxImages);
      if (allowed >= variants) return null;
      return `${shortModelLabel(id, model?.name)} max is ${allowed}`;
    })
    .filter((item): item is string => Boolean(item));
  const editingCustom = styleIds.includes("custom");
  const singlePreset = styleIds.length === 1 && styleIds[0] !== "custom";
  const paletteStyles = styleIds.map(styleById).filter(showsPalettePicker);
  const resultCost = result
    ? formatCostBreakdown({ promptCost: result.promptCost, cost: result.cost })
    : "";
  const runsBatchCost = formatBatchCost(modelRuns);
  const compareItems = batchResults.length ? batchResults : result ? [result] : [];
  const compareStyles =
    new Set(compareItems.map((item) => planSlotKey(item.styleId, item.paletteId ?? AUTO_PALETTE_ID))).size > 1;
  const compareModels = new Set(compareItems.map((item) => item.model)).size > 1;
  const resultsBatchCost = formatBatchCost(compareItems);
  const schematicSrc =
    sentRefs.find((item) => item.role === "schematic")?.dataUrl ??
    (result ? `/api/posters/${result.posterId}/ref-1.png` : null);
  const compareImages: CompareImage[] = [
    ...(schematicSrc ? [{ id: "schematic", src: schematicSrc, label: "schematic" }] : []),
    ...compareItems.map((item) => ({
      id: item.posterId,
      src: item.url,
      label:
        [
          compareStyles ? resultSlotLabel(item) : null,
          compareModels || !compareStyles ? shortModelLabel(item.model, item.modelName) : null,
          posterVariantLabel(item, compareItems),
          item.durationMs != null ? formatDurationMs(item.durationMs) : null,
        ]
          .filter(Boolean)
          .join(" · ") || "result",
    })),
  ];

  function applyRouteOnly(next: boolean) {
    if (next === routeOnly) return;
    setRouteOnly(next);
    setSpecs({});
    setPlanCosts({});
  }

  function applyCrop(nextStart: number, nextEnd: number) {
    if (!context) return;
    const radius = snapRadius(context.latlng.length);
    const lo = nextStart === cropStart ? nextStart : snapIndex(nextStart, stopIndexes, radius);
    const hi = nextEnd === cropEnd ? nextEnd : snapIndex(nextEnd, stopIndexes, radius);
    const [start, end] = clampCrop(context.latlng.length, lo, hi);
    setCropStart(start);
    setCropEnd(end);
  }

  useEffect(() => {
    if (!compareOpen && !preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (preview) setPreview(null);
      else setCompareOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareOpen, preview]);

  const sheetMode = sheetSnap != null;
  const labelCount = selectedPois.length + selectedNamedWays.length + selectedNamedAreas.length;
  const showOnMapStep =
    sheetMode &&
    !routeOnly &&
    (selectedNamedAreas.length > 0 || selectedNamedWays.length > 0 || selectedPois.length > 0);
  const workflowSteps = useMemo(() => {
    const steps: { id: PosterWorkflowStep; label: string }[] = [
      { id: "crop", label: "Crop" },
      { id: "geography", label: "Geography" },
    ];
    if (showOnMapStep) steps.push({ id: "on-map", label: "On map" });
    steps.push(
      { id: "annotations", label: "Annotations" },
      { id: "themes", label: "Themes" },
      { id: "stats", label: "Stats" },
      { id: "output", label: "Output" },
    );
    if (spec && specSlot) steps.push({ id: "prompt", label: "Prompt" });
    if (result) steps.push({ id: "result", label: batchResults.length > 1 ? "Results" : "Result" });
    return steps;
  }, [showOnMapStep, spec, specSlot, result, batchResults.length]);
  const peekStatus =
    loading && !showEditor
      ? "Loading…"
      : generating
        ? `Generating… ${elapsed}s`
        : planning
          ? `Planning… ${elapsed}s`
          : result
            ? "Result ready"
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
  }, [sheetMode, sheetSnap, onSheetHeightChange, showEditor, loading, error, workflowStep]);

  useEffect(() => {
    if (!sheetMode) return;
    if (workflowSteps.some((step) => step.id === workflowStep)) return;
    setWorkflowStep(workflowSteps[0]?.id ?? "crop");
  }, [sheetMode, workflowStep, workflowSteps]);

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
    >
      {sheetMode ? (
        <div className="poster-sheet-chrome">
          <button
            type="button"
            className="poster-sheet-handle"
            aria-label="Resize poster sheet"
            onPointerDown={onSheetPointerDown}
            onPointerUp={onSheetPointerUp}
          >
            <span />
          </button>
          <div className="poster-sheet-peek">
            <div className="poster-sheet-peek-text">
              <strong>{context?.activity.name ?? "Create poster"}</strong>
              {peekStatus ? <p className="muted">{peekStatus}</p> : null}
            </div>
          </div>
          {showEditor && context && sheetSnap !== "peek" && (
            <nav className="poster-workflow-nav" aria-label="Poster steps">
              {workflowSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={workflowStep === step.id ? "on" : undefined}
                  aria-current={workflowStep === step.id ? "step" : undefined}
                  onClick={() => selectWorkflowStep(step.id)}
                >
                  {step.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      ) : (
        <div className="panel-block poster-head">
          <div>
            <div className="eyebrow">Poster</div>
            <strong>{context?.activity.name ?? "Create poster"}</strong>
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
            Loading nearby features…
          </p>
        </div>
      )}
      {error && (
        <div className="panel-block sheet-from-half">
          <p className="error">{error}</p>
        </div>
      )}
      {showEditor && context && (
        <div className="poster-body">
          <PosterSection
            title="Crop track"
            accordion={false}
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
                    placeholder="Start location"
                    onChange={(event) => {
                      setPlacesEdited(true);
                      setStartPlace(event.target.value);
                    }}
                  />
                  <input
                    className="search"
                    value={finishPlace}
                    placeholder="Finish location"
                    onChange={(event) => {
                      setPlacesEdited(true);
                      setFinishPlace(event.target.value);
                    }}
                  />
                </>
              )}
            </div>
            <p className="muted">
              {showRouteMarkers
                ? isClosedLoop(croppedLatLng)
                  ? "Start and finish are the same place — one combined marker. "
                  : "Green start · black finish. "
                : ""}
              The finished poster writes this name at the start/finish marker.
            </p>
          </PosterSection>

          <PosterSection
            title="Geography"
            accordion={false}
            showTitle={!sheetMode}
            className={workflowPane("geography")}
            hint={featuresRefreshing ? <FeatureQueryHint label="Querying OpenStreetMap…" /> : undefined}
          >
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
          </PosterSection>

          {showOnMapStep && (
            <PosterSection
              title="On map"
              accordion={false}
              showTitle={false}
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
                    onSelect={() => {
                      setSelectedChip({ kind: "poi", name: poi.name });
                      onHighlightChange?.({ kind: "poi", name: poi.name });
                    }}
                    onRemove={() => {
                      removePoi(poi.name);
                      setSelectedChip(null);
                    }}
                    onHighlightChange={onHighlightChange}
                  />
                ))}
              </div>
            </PosterSection>
          )}

          <PosterSection
            title="Annotations"
            accordion={false}
            showTitle={!sheetMode}
            className={workflowPane("annotations")}
            busy={featuresRefreshing}
            hint={featuresRefreshing ? <FeatureQueryHint label="Querying OpenStreetMap…" /> : undefined}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={!routeOnly}
                onChange={(event) => applyRouteOnly(!event.target.checked)}
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
                  Auto-added if within this many metres of the route.
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
                        onSelect={() => {
                          setSelectedChip({ kind: "poi", name: poi.name });
                          onHighlightChange?.({ kind: "poi", name: poi.name });
                        }}
                        onRemove={() => {
                          removePoi(poi.name);
                          setSelectedChip(null);
                        }}
                        onHighlightChange={onHighlightChange}
                      />
                    ))}
                  </div>
                )}
                {(selectedPois.length > 0 || selectedNamedWays.length > 0 || selectedNamedAreas.length > 0) && (
                  <p className="muted">
                    Neighbourhoods, campuses, and large named parks are ochre washes with a letter,
                    not pins. The wash is the exact area to label on the poster. Letters and trail
                    colors are a private index — look up the name, then discard the letter and the
                    schematic colors. Parks stay green; other districts should not be brown just
                    because the schematic wash is ochre. Numbered discs are a location index. The
                    poster should show the names, not the letters, numbers, schematic colors, or a
                    legend.
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
                  Places that are not on OSM, and stretches that are not on Strava, are labeled on
                  the schematic: Place landmark or Name stretch. Drag a numbered landmark to move it.
                  Click a named stretch — or its chip — to rename a Strava or hand-named trail.
                </p>
                {landmarkHint && <p className="muted">{landmarkHint}</p>}
                {landmarkChoices?.map((poi) => (
                  <button key={`${poi.name}-${poi.lat}`} type="button" className="chip" onClick={() => addCustom(poi)}>
                    {poi.name}
                  </button>
                ))}
              </>
            )}
          </PosterSection>

          <PosterSection
            title="Themes"
            accordion={false}
            showTitle={!sheetMode}
            className={workflowPane("themes")}
          >
            <div className="chip-row">
              {POSTER_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={`chip ${styleIds.includes(style.id) ? "on" : ""}`}
                  onClick={() => toggleStyle(style.id)}
                >
                  {style.label}
                </button>
              ))}
            </div>
            <p className="muted">
              {!styleIds.length
                ? "Select a theme to plan"
                : planSlots.length > 1
                  ? `${planSlots.length} prompts — one per selected theme and palette`
                  : "Select more themes or palettes to compare"}
            </p>
            {paletteStyles.map((style) => {
              const selected = paletteIdsForStyle(style, paletteIdsByStyle[style.id]);
              return (
                <div key={style.id} className="palette-group">
                  <div className="eyebrow">
                    {paletteStyles.length > 1 ? `${style.label} palette` : "Palette"}
                  </div>
                  <div className="chip-row">
                    <button
                      type="button"
                      className={`chip ${selected.includes(AUTO_PALETTE_ID) ? "on" : ""}`}
                      onClick={() => togglePalette(style.id, AUTO_PALETTE_ID)}
                    >
                      Auto
                    </button>
                    {stylePalettes(style).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`chip ${selected.includes(item.id) ? "on" : ""}`}
                        onClick={() => togglePalette(style.id, item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {selected.length > 1 && (
                    <p className="muted">{selected.length} palettes will each get their own prompt</p>
                  )}
                </div>
              );
            })}
            {(editingCustom || singlePreset) && (
              <textarea
                className="poster-prompt"
                rows={5}
                value={editingCustom ? stylePrompt : styleById(styleIds[0]).prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  if (singlePreset) {
                    const fromId = styleIds[0];
                    for (const paletteId of paletteIdsForStyle(styleById(fromId), paletteIdsByStyle[fromId])) {
                      dropSlot(fromId, paletteId);
                    }
                    setStyleIds(["custom"]);
                    setActiveStyleId("custom");
                    setPaletteIdsByStyle({ custom: [AUTO_PALETTE_ID] });
                    setActivePlanKey(planSlotKey("custom", AUTO_PALETTE_ID));
                  }
                  setStylePrompt(value);
                }}
                placeholder="Custom style prompt"
              />
            )}
            {styleIds.length > 1 && editingCustom && (
              <p className="muted">Custom uses this prompt; other themes use their presets.</p>
            )}
          </PosterSection>

          <PosterSection
            title="Stats on poster"
            accordion={false}
            showTitle={!sheetMode}
            className={workflowPane("stats")}
          >
            {listedStats.map((stat) => (
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
            <input className="search" value={title} onChange={(event) => setTitle(event.target.value)} />
            <p className="muted">{subtitle || "No stats selected"}</p>
          </PosterSection>

          <PosterSection
            title="Output"
            accordion={false}
            showTitle={!sheetMode}
            className={workflowPane("output")}
          >
            <div className="poster-option-row">
              <label className="poster-field">
                Aspect
                <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                  {ASPECTS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="poster-field">
                Variants
                <select
                  value={variants}
                  onChange={(event) => applyVariants(Number(event.target.value))}
                >
                  {Array.from({ length: MAX_VARIANTS }, (_, index) => index + 1).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {variantCaps.length || variants > 1 ? (
              <p className="muted">
                {variantCaps.length
                  ? variantCaps.join(" · ")
                  : `${variants} images per prompt, one request`}
              </p>
            ) : null}
            {!sheetMode && schematicUrl ? (
              <div className="preview-grid">
                <GroundingThumb
                  src={schematicUrl}
                  label="schematic"
                  onOpen={() => setPreview({ src: schematicUrl, label: "schematic" })}
                />
                {maxRefs >= 2 && satelliteUrl && (
                  <GroundingThumb
                    src={satelliteUrl}
                    label="satellite"
                    onOpen={() => setPreview({ src: satelliteUrl, label: "satellite" })}
                  />
                )}
              </div>
            ) : null}
            {!sheetMode && (
              <p className="muted">
                {sentRefsHint(
                  maxRefs,
                  Boolean(satelliteUrl),
                  maxRefs >= 2 && Boolean(schematicUrl) && !satelliteUrl,
                )}
              </p>
            )}
            {context.warnings.length ? <p className="muted">{context.warnings.join(" · ")}</p> : null}
            <div className="poster-actions poster-plan-row">
              <button className="button" type="button" disabled={busy || !title.trim() || !styleIds.length} onClick={() => void handlePlan()}>
                {planning
                  ? planProgress.total > 1
                    ? `Planning ${planProgress.done}/${planProgress.total}… ${elapsed}s`
                    : `Planning… ${elapsed}s`
                  : plannedSlots.length
                    ? planSlots.length > 1
                      ? "Re-plan prompts"
                      : "Re-plan"
                    : planSlots.length > 1
                      ? "Plan prompts"
                      : "Plan prompt"}
              </button>
              {planDisabledHint ? <p className="muted">{planDisabledHint}</p> : null}
            </div>
            {plannedSlots.length > 0 && !allThemesPlanned && (
              <p className="muted">Plan prompts for the newly selected themes and palettes before generating.</p>
            )}
          </PosterSection>

          {spec && specSlot && (
            <PosterSection
              title="Prompt"
              accordion={false}
              showTitle={!sheetMode}
              className={workflowPane("prompt")}
            >
              {plannedSlots.length > 1 && (
                <div className="chip-row">
                  {plannedSlots.map((slot) => (
                    <button
                      key={slot.key}
                      type="button"
                      className={`chip ${slot.key === specSlot.key ? "on" : ""}`}
                      onClick={() => {
                        setActiveStyleId(slot.styleId);
                        setActivePlanKey(slot.key);
                      }}
                    >
                      {planSlotLabel(slot.styleId, slot.paletteId, specForSlot(specs, slot.styleId, slot.paletteId)?.style.name)}
                    </button>
                  ))}
                </div>
              )}
              <SpecEditor
                spec={spec}
                onChange={(next) =>
                  setSpecs((current) => ({ ...current, [specSlot.key]: next }))
                }
              />
              <button
                className="button"
                type="button"
                disabled={busy || !allThemesPlanned}
                onClick={() => void handleGenerate()}
              >
                {generating
                  ? generateProgress.total > 1
                    ? `Generating ${generateProgress.done}/${generateProgress.total}… ${elapsed}s`
                    : generateCount > 1
                      ? `Generating ${generateCount} variants… ${elapsed}s`
                      : `Generating… ${elapsed}s`
                  : generateCount > 1
                    ? plannedSlots.length > 1
                      ? `Generate ${plannedSlots.length} posters (${generateCount} variants)`
                      : `Generate ${generateCount} variants`
                    : "Generate poster"}
              </button>
              {modelRuns.length > 0 && (
                <ul className="model-times">
                  {modelRuns.map((run) => {
                    const ms = (run.finishedAt ?? Date.now()) - run.startedAt;
                    const time = formatDurationMs(ms);
                    const status = run.error ? "failed" : run.finishedAt ? "done" : "running";
                    const showStyle = planSlots.length > 1;
                    const showModel = imageModelIds.length > 1 || !showStyle;
                    const cost = formatCostBreakdown({
                      promptCost: run.promptCost,
                      imageCost: run.imageCost,
                    });
                    return (
                      <li key={run.key} className={`model-time ${status}`}>
                        <span>
                          {[showStyle ? run.styleLabel : null, showModel ? run.label : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span>
                          {time}
                          {run.finishedAt ? "" : "…"}
                          {cost ? ` · ${cost}` : ""}
                          {run.error ? " · failed" : ""}
                        </span>
                      </li>
                    );
                  })}
                  {runsBatchCost ? (
                    <li className="model-time total">
                      <span>Batch</span>
                      <span>{runsBatchCost}</span>
                    </li>
                  ) : null}
                </ul>
              )}
            </PosterSection>
          )}

          {result && (
            <PosterSection
              title={batchResults.length > 1 ? "Compare results" : "Result"}
              accordion={false}
              showTitle={!sheetMode}
              className={workflowPane("result")}
            >
              <div className="result-compare">
                {schematicSrc && (
                  <figure className="result-compare-card">
                    <img src={schematicSrc} alt="Reference schematic" />
                    <span>schematic</span>
                  </figure>
                )}
                {compareItems.map((item) => (
                  <button
                    key={item.posterId}
                    type="button"
                    className={`result-compare-card ${item.posterId === result.posterId ? "on" : ""}`}
                    onClick={() => selectResult(item)}
                  >
                    <img src={item.url} alt={item.title} />
                    <span>
                      {[
                        compareStyles ? resultSlotLabel(item) : null,
                        compareModels || !compareStyles
                          ? shortModelLabel(item.model, item.modelName)
                          : null,
                        posterVariantLabel(item, compareItems),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "result"}
                    </span>
                    {item.durationMs != null && <span>{formatDurationMs(item.durationMs)}</span>}
                  </button>
                ))}
              </div>
              <div className="poster-actions">
                {compareImages.length > 1 && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      const pair = defaultComparePair(compareImages, result.posterId);
                      setCompareLeftId(pair.leftId);
                      setCompareRightId(pair.rightId);
                      setCompareFocus("right");
                      setCompareOpen(true);
                    }}
                  >
                    Compare side by side
                  </button>
                )}
                <a className="button" href={result.url} download={`${result.posterId}.png`}>
                  Download
                </a>
                <ShareButton url={result.url} filename={`${result.posterId}.png`} />
                <a className="text-btn" href={result.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              <p className="muted">
                {resultSlotLabel(result)}
                {` · ${shortModelLabel(result.model, result.modelName)}`}
                {result.durationMs != null ? ` · ${formatDurationMs(result.durationMs)}` : ""}
                {resultCost ? ` · ${resultCost}` : ""}
              </p>
              {compareItems.length > 1 && resultsBatchCost ? (
                <p className="muted">{resultsBatchCost}</p>
              ) : null}
              {sentRefs.length > 0 && (
                <>
                  <div className="eyebrow">Sent to the model</div>
                  <div className="preview-grid">
                    {sentRefs.map((item, index) => (
                      <GroundingThumb
                        key={`${item.role}-${index}`}
                        src={item.dataUrl}
                        label={item.role}
                        onOpen={() => setPreview({ src: item.dataUrl, label: item.role })}
                      />
                    ))}
                  </div>
                </>
              )}
              {refineFrom && result.posterId === refineFrom.posterId && (
                <p className="muted">
                  Setup restored from this poster. Change landmarks, crop, or themes, then Plan + Generate.
                </p>
              )}
            </PosterSection>
          )}
        </div>
      )}
    </aside>
    {preview && (
      <div className="lightbox" onClick={() => setPreview(null)}>
        <div className="lightbox-inner lightbox-preview" onClick={(event) => event.stopPropagation()}>
          <img className="lightbox-preview-img" src={preview.src} alt={preview.label} />
          <div className="lightbox-bar">
            <strong>{preview.label}</strong>
            <div className="poster-actions">
              <button type="button" className="text-btn" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {compareOpen && result && compareImages.length > 1 && (
      <div className="lightbox" onClick={() => setCompareOpen(false)}>
        <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
          <BatchCompare
            images={compareImages}
            leftId={compareLeftId}
            rightId={compareRightId}
            focus={compareFocus}
            onFocus={setCompareFocus}
            onSelect={(id) => {
              if (compareFocus === "left") setCompareLeftId(id);
              else setCompareRightId(id);
              if (id === "schematic") return;
              const poster = compareItems.find((item) => item.posterId === id);
              if (poster) selectResult(poster);
            }}
            onSwap={() => {
              setCompareLeftId(compareRightId);
              setCompareRightId(compareLeftId);
            }}
          />
          <div className="lightbox-bar">
            <strong>{result.title}</strong>
            <span className="muted">{result.subtitle}</span>
            <div className="poster-actions">
              <button type="button" className="text-btn" onClick={() => setCompareOpen(false)}>
                Close
              </button>
              <a className="button" href={result.url} download={`${result.posterId}.png`}>
                Download selected
              </a>
              <ShareButton url={result.url} filename={`${result.posterId}.png`} />
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
