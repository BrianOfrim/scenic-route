import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { FEATURE_CATALOG, DEFAULT_FEATURE_IDS, type FeatureOption } from "./featureCatalog";
import { planContactSheets, renderContactSheets, type GroundingLayer } from "./grounding/contactSheet";
import {
  renderSchematicDataUrl,
  schematicLayersFromFeatureIds,
  type AspectRatio,
} from "./grounding/renderSchematic";
import { snapshotTiles } from "./grounding/snapshotTiles";
import { applyTrailAlias, nextTrailAliases, trailSourceName, userLandmark, userNamedWay } from "./annotate";
import {
  asAspectRatio,
  captureEditorSnapshot,
  editorSeed,
  restoreEditor,
  styleIdFromRecord,
} from "./editorSnapshot";
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
  minMaxReferences,
  posterVariantLabel,
  readStoredImageModels,
  readStoredVariants,
  shortModelLabel,
  sumCosts,
  variantCount,
  writeStoredImageModels,
  writeStoredVariants,
} from "./imageModels";

import { BatchCompare, defaultComparePair, type CompareImage } from "../compare/BatchCompare";
import { DEFAULT_POSTER_STYLE, POSTER_STYLES, styleById, styleLabel } from "./styles";

type GenerationRun = {
  key: string;
  styleId: string;
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

const SCHEMATIC_LEGEND =
  "red = unnamed GPS track; colored route stretches = named trails, private color index, do not copy onto the poster; grey = roads; blue = water; green = forest; ochre wash + letter = named district, private region index, copy the footprint not the ochre or letter; numbered discs = private location index, do not copy";

const SATELLITE_LEGEND =
  "real aerial imagery of the same frame; red = GPS track; use for land cover, water, vegetation, and built form; every red stroke is a required segment; do not copy the photograph";


function TrailChip({
  trail,
  editing,
  draft,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onRemove,
}: {
  trail: NamedWay;
  editing: boolean;
  draft: string;
  onEdit: () => void;
  onDraft: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  onRemove: () => void;
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
    <span className="chip on" title={editing ? undefined : `${title}. Click the name to rename.`}>
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
        onClick={onRemove}
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

function schematicLegend(markers: false | "ends" | "loop") {
  if (markers === "loop") return `${SCHEMATIC_LEGEND}; gold/green = combined start/finish`;
  if (markers === "ends") return `${SCHEMATIC_LEGEND}; green/black dots = start/finish`;
  return SCHEMATIC_LEGEND;
}

function groundingLayers(
  schematicUrl: string | null,
  satelliteUrl: string | null,
  maxRefs: number,
  latlng: [number, number][],
  showMarkers: boolean,
): GroundingLayer[] {
  if (!schematicUrl) return [];
  const layers: GroundingLayer[] = [
    {
      role: "schematic",
      legend: schematicLegend(routeMarkerMode(showMarkers, latlng)),
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
  refineFrom?: PosterRecord | null;
  dismissPoi?: { name: string; nonce: number } | null;
  dismissArea?: { name: string; nonce: number } | null;
  dismissTrail?: { name: string; nonce: number } | null;
  placeLandmark?: { name: string; lat: number; lng: number; nonce: number } | null;
  placeSection?: { name: string; start: number; end: number; nonce: number } | null;
  renameTrail?: { name: string; next: string; nonce: number } | null;
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
  refineFrom,
  dismissPoi,
  dismissArea,
  dismissTrail,
  placeLandmark,
  placeSection,
  renameTrail: renameTrailEvent,
}: Props) {
  const catalog = FEATURE_CATALOG.map(
    (item) => features.find((feature) => feature.id === item.id) ?? item,
  );
  const seeded = useMemo(() => editorSeed(refineFrom), [refineFrom]);
  const [context, setContext] = useState<PosterContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureIds, setFeatureIds] = useState<string[]>(() => seeded?.featureIds ?? DEFAULT_FEATURE_IDS);
  const [styleIds, setStyleIds] = useState<string[]>(() => seeded?.styleIds ?? [styleIdFromRecord(refineFrom)]);
  const [stylePrompt, setStylePrompt] = useState(seeded?.stylePrompt || DEFAULT_POSTER_STYLE.prompt);
  const [activeStyleId, setActiveStyleId] = useState(() => seeded?.styleIds[0] ?? styleIdFromRecord(refineFrom));
  const [title, setTitle] = useState(seeded?.title ?? "");
  const [startPlace, setStartPlace] = useState("");
  const [finishPlace, setFinishPlace] = useState("");
  const [placesEdited, setPlacesEdited] = useState(false);
  const [statIds, setStatIds] = useState<string[]>(["title", "date", "distance", "movingTime"]);
  const [labels, setLabels] = useState<string[]>([]);
  const [trailNames, setTrailNames] = useState<string[]>([]);
  const [trailAliases, setTrailAliases] = useState<Record<string, string>>({});
  const [editingTrail, setEditingTrail] = useState<string | null>(null);
  const [editingTrailName, setEditingTrailName] = useState("");
  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [customPois, setCustomPois] = useState<PosterPoi[]>([]);
  const [customWays, setCustomWays] = useState<NamedWay[]>([]);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const [showRouteMarkers, setShowRouteMarkers] = useState(seeded?.showRouteMarkers ?? true);
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [landmarkChoices, setLandmarkChoices] = useState<PosterPoi[] | null>(null);
  const [landmarkHint, setLandmarkHint] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => asAspectRatio(seeded?.aspectRatio));
  const [schematicUrl, setSchematicUrl] = useState<string | null>(null);
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null);
  const [modelRefs, setModelRefs] = useState<ModelRef[]>([]);
  const [sentRefs, setSentRefs] = useState<ModelRef[]>([]);
  const [maxRefs, setMaxRefs] = useState(3);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [imageModelIds, setImageModelIds] = useState(() => {
    if (seeded?.imageModelIds?.length) return seeded.imageModelIds;
    const stored = readStoredImageModels();
    return refineFrom?.model && !stored.includes(refineFrom.model)
      ? [...stored, refineFrom.model]
      : stored;
  });
  const [variants, setVariants] = useState(() => seeded?.variants ?? readStoredVariants());
  const [specs, setSpecs] = useState<Partial<Record<string, PosterSpec>>>(() => seeded?.specs ?? {});
  const [planCosts, setPlanCosts] = useState<Partial<Record<string, number | null>>>(() => seeded?.planCosts ?? {});
  const [planning, setPlanning] = useState(false);
  const [planProgress, setPlanProgress] = useState({ done: 0, total: 0 });
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });
  const [modelRuns, setModelRuns] = useState<GenerationRun[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PosterRecord | null>(null);
  const [batchResults, setBatchResults] = useState<PosterRecord[]>([]);
  const [refineNotes, setRefineNotes] = useState("");
  const [preview, setPreview] = useState<{ src: string; label: string } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [compareFocus, setCompareFocus] = useState<"left" | "right">("right");
  const cropActivityId = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPosterCapabilities().then((caps) => {
      if (cancelled) return;
      setImageModels(caps.models);
      setImageModelIds((current) => {
        const known = current.filter(
          (id) => id === refineFrom?.model || caps.models.some((item) => item.id === id),
        );
        if (known.length) return known;
        const fallback = caps.defaultModel || caps.models[0]?.id || "";
        return fallback ? [fallback] : [];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!imageModelIds.length) return;
    if (imageModelIds.length > 1) {
      setMaxRefs(minMaxReferences(imageModelIds, imageModels));
      return;
    }
    let cancelled = false;
    void fetchMaxReferences(imageModelIds[0]).then((value) => {
      if (!cancelled) setMaxRefs(value);
    });
    return () => {
      cancelled = true;
    };
  }, [imageModelIds.join("\0"), imageModels]);

  useEffect(() => {
    let cancelled = false;
    const activityChanged = cropActivityId.current !== activityId;
    if (activityChanged) {
      setLoading(true);
      setError(null);
    }
    fetchPosterContext(
      activityId,
      featureIds.filter((id) => id !== "named-trails"),
    )
      .then((next) => {
        if (cancelled) return;
        setContext(next);
        if (activityChanged) {
          cropActivityId.current = activityId;
          setEditingTrail(null);
          setLandmarkQuery("");
          setLandmarkChoices(null);
          setLandmarkHint(null);
          if (refineFrom) {
            const restored = restoreEditor(refineFrom, next.latlng.length, {
              title: next.activity.name || "Ride",
              labels: next.pois.map((poi) => poi.name),
              trailNames: (next.namedWays ?? []).map((trail) => trail.name),
              areaNames: (next.namedAreas ?? []).map((area) => area.name),
            });
            setFeatureIds(restored.featureIds);
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
            setStartPlace(restored.startPlace);
            setFinishPlace(restored.finishPlace);
            setPlacesEdited(restored.placesEdited);
            setStatIds(restored.statIds);
            setAspectRatio(restored.aspectRatio);
            setStyleIds(restored.styleIds);
            setStylePrompt(restored.stylePrompt);
            setActiveStyleId(restored.styleIds[0] ?? styleIdFromRecord(refineFrom));
            setSpecs(restored.specs);
            setPlanCosts(restored.planCosts);
            if (restored.imageModelIds?.length) setImageModelIds(restored.imageModelIds);
            if (restored.variants != null) setVariants(restored.variants);
            setSentRefs(savedModelRefs(refineFrom));
          } else {
            setLabels(next.pois.map((poi) => poi.name));
            setTrailNames((next.namedWays ?? []).map((trail) => trail.name));
            setAreaNames((next.namedAreas ?? []).map((area) => area.name));
            setTitle(next.activity.name || "Ride");
            setCropStart(0);
            setCropEnd(Math.max(1, next.latlng.length - 1));
            setPlacesEdited(false);
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
  }, [activityId, featureIds.join(",")]);

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
  const selectedPois = useMemo(() => {
    const suggested = (context?.pois ?? []).filter((poi) => labels.includes(poi.name));
    const ranked = prioritizeLabels(suggested, customPois);
    if (croppedLatLng.length < 2) return ranked;
    const customNames = new Set(customPois.map((poi) => poi.name.trim().toLowerCase()));
    return ranked.filter(
      (poi) => customNames.has(poi.name.trim().toLowerCase()) || isNearCroppedRoute(poi, croppedLatLng),
    );
  }, [context, labels, customPois, croppedLatLng]);

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
    const areas = (context?.namedAreas ?? []).filter((area) => areaNames.includes(area.name));
    const nearRoute =
      croppedLatLng.length < 2 ? areas : areas.filter((area) => isNearCroppedRoute(area, croppedLatLng));
    return assignAreaLetters(nearRoute);
  }, [context, areaNames, croppedLatLng]);

  const schematicLayers = useMemo(
    () => schematicLayersFromFeatureIds(featureIds, routeMarkerMode(showRouteMarkers, croppedLatLng)),
    [featureIds, showRouteMarkers, croppedLatLng],
  );

  const displayBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return context?.bbox ?? null;
    return paddedBbox(croppedLatLng, [...selectedPois, ...selectedNamedWays, ...selectedNamedAreas]);
  }, [context, croppedLatLng, selectedPois, selectedNamedWays, selectedNamedAreas]);
  const groundingBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return displayBbox;
    return schematicBbox(croppedLatLng, [...selectedPois, ...selectedNamedWays, ...selectedNamedAreas]);
  }, [croppedLatLng, selectedPois, selectedNamedWays, selectedNamedAreas, displayBbox]);

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
    onPoisChange?.(selectedPois);
  }, [selectedPois, onPoisChange]);

  useEffect(() => {
    onNamedWaysChange?.(selectedNamedWays);
  }, [selectedNamedWays, onNamedWaysChange]);

  useEffect(() => {
    onNamedAreasChange?.(selectedNamedAreas);
  }, [selectedNamedAreas, onNamedAreasChange]);

  useEffect(() => {
    onWaysChange?.(context?.ways ?? null);
  }, [context, onWaysChange]);

  useEffect(() => {
    onSchematicLayersChange?.(schematicLayers);
  }, [schematicLayers, onSchematicLayersChange]);

  const removePoi = useCallback((name: string) => {
    setCustomPois((current) => current.filter((item) => item.name !== name));
    setLabels((current) => current.filter((item) => item !== name));
  }, []);

  const removeArea = useCallback((name: string) => {
    setAreaNames((current) => current.filter((item) => item !== name));
  }, []);

  const removeTrail = useCallback((name: string) => {
    const source = trailSourceName(name, trailAliases);
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
          pois: selectedPois,
          namedWays: selectedNamedWays,
          namedAreas: selectedNamedAreas,
          aspectRatio,
          layers: schematicLayers,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render schematic");
    }
  }, [context, croppedLatLng, groundingBbox, selectedPois, selectedNamedWays, selectedNamedAreas, aspectRatio, schematicLayers]);

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
  }, [schematicUrl, satelliteUrl, maxRefs, aspectRatio, showRouteMarkers, croppedLatLng]);

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
    );
  }

  async function handlePlan() {
    if (!context) return;
    const selectedStyles = styleIds.map((id) => styleById(id));
    if (!selectedStyles.length) return;
    setPlanning(true);
    setError(null);
    setPlanProgress({ done: 0, total: selectedStyles.length });
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
        pois: selectedPois,
        namedWays: selectedNamedWays,
        namedAreas: selectedNamedAreas,
        grounding: packed.map((sheet, index) => ({
          index: index + 1,
          role: sheet.role,
          legend: sheet.legend,
        })),
        refineNotes: refineNotes || undefined,
      };
      const settled = await Promise.all(
        selectedStyles.map(async (style) => {
          try {
            const planned = await planPoster({
              ...base,
              style,
              customStylePrompt: style.id === "custom" ? stylePrompt : undefined,
              previousSpec:
                specs[style.id] ??
                (refineFrom && refineFrom.styleId === style.id ? refineFrom.spec : undefined),
            });
            return { styleId: style.id, spec: planned.spec, cost: planned.cost };
          } catch (err) {
            return {
              styleId: style.id,
              error: err instanceof Error ? err.message : "Planner failed",
              cost: null,
            };
          } finally {
            setPlanProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }),
      );
      const planned = settled.flatMap((item) =>
        item.spec ? [{ styleId: item.styleId, spec: item.spec, cost: item.cost }] : [],
      );
      const failures = settled.flatMap((item) =>
        item.error ? [`${styleLabel(item.styleId)}: ${item.error}`] : [],
      );
      if (!planned.length) throw new Error(failures.join(" · ") || "Planner failed");
      setSpecs((current) => {
        const next = { ...current };
        for (const item of planned) next[item.styleId] = item.spec;
        return next;
      });
      setPlanCosts((current) => {
        const next = { ...current };
        for (const item of planned) next[item.styleId] = item.cost ?? null;
        return next;
      });
      if (!planned.some((item) => item.styleId === activeStyleId)) {
        setActiveStyleId(planned[0].styleId);
      }
      if (failures.length) {
        setError(`${failures.length} theme${failures.length === 1 ? "" : "s"} failed to plan. ${failures.join(" · ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planner failed");
    } finally {
      setPlanning(false);
    }
  }

  async function handleGenerate() {
    if (!context) return;
    const jobs = styleIds.flatMap((styleId) => {
      const planned = specs[styleId];
      if (!planned) return [];
      const style = styleById(styleId);
      return imageModelIds.map((model) => ({
        key: `${styleId}\0${model}`,
        styleId,
        style,
        spec: planned,
        model,
      }));
    });
    if (!jobs.length) return;
    setGenerating(true);
    setError(null);
    try {
      const layers = await buildGrounding();
      const packed = await renderContactSheets(layers, maxRefs, aspectRatio);
      setSentRefs(packed.map((item) => ({ role: item.role, legend: item.legend, dataUrl: item.dataUrl })));
      if (!imageModelIds.length) throw new Error("Select at least one image model");
      const batchId = crypto.randomUUID();
      setGenerateProgress({ done: 0, total: jobs.length });
      const startedAt = Date.now();
      setModelRuns(
        jobs.map((job) => ({
          key: job.key,
          styleId: job.styleId,
          styleLabel: job.style.label,
          model: job.model,
          label: shortModelLabel(job.model, imageModels.find((item) => item.id === job.model)?.name),
          startedAt,
          promptCost: planCosts[job.styleId] ?? null,
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
              refineNotes: refineNotes || undefined,
              featureIds,
              labels: selectedPois.map((poi) => poi.name),
              stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
              styleId: job.styleId,
              stylePrompt: job.style.id === "custom" ? stylePrompt : job.style.prompt,
              aspectRatio,
              batchId,
              model: job.model,
              variants,
              promptCost: planCosts[job.styleId] ?? null,
              editor: captureEditorSnapshot({
                featureIds,
                labels,
                trailNames,
                trailAliases,
                areaNames,
                customPois,
                customWays,
                cropStart,
                cropEnd,
                showRouteMarkers,
                title,
                startPlace,
                finishPlace,
                placesEdited,
                statIds,
                aspectRatio,
                styleIds,
                stylePrompt,
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
            return { key: job.key, styleId: job.styleId, model: job.model, records };
          } catch (err) {
            const error = err instanceof Error ? err.message : "Poster generation failed";
            setModelRuns((current) =>
              current.map((run) =>
                run.key === job.key ? { ...run, finishedAt: Date.now(), error } : run,
              ),
            );
            return { key: job.key, styleId: job.styleId, model: job.model, error };
          } finally {
            setGenerateProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }),
      );
      const records = settled.flatMap((item) => item.records ?? []);
      const failures = settled.flatMap((item) => {
        if (!item.error) return [];
        const theme = styleLabel(item.styleId);
        const model = shortModelLabel(item.model);
        return [`${styleIds.length > 1 ? `${theme} · ` : ""}${model}: ${item.error}`];
      });
      if (!records.length) throw new Error(failures.join(" · ") || "Poster generation failed");
      setBatchResults(records);
      setResult(records[0]);
      setActiveStyleId(records[0].styleId || activeStyleId);
      setRefineNotes("");
      if (failures.length) {
        setError(`${failures.length} poster${failures.length === 1 ? "" : "s"} failed. ${failures.join(" · ")}`);
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
    setLabels((current) => (current.includes(poi.name) ? current : [...current, poi.name]));
    setLandmarkChoices(null);
  }

  function addCustomWay(way: NamedWay) {
    setCustomWays((current) =>
      current.some((item) => item.name.toLowerCase() === way.name.toLowerCase()) ? current : [...current, way],
    );
  }

  function toggleFeature(id: string) {
    setFeatureIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleStyle(id: string) {
    setStyleIds((current) => {
      if (current.includes(id)) {
        if (current.length === 1) return current;
        const next = current.filter((item) => item !== id);
        setActiveStyleId((active) => (active === id ? next[0] : active));
        return next;
      }
      setActiveStyleId(id);
      if (id === "custom" && !stylePrompt) {
        const from = styleById(activeStyleId);
        if (from.prompt) setStylePrompt(from.prompt);
      }
      return [...current, id];
    });
  }

  function applyImageModels(ids: string[]) {
    const next = ids.filter(Boolean);
    if (!next.length) return;
    setImageModelIds(next);
    writeStoredImageModels(next);
    setMaxRefs(next.length === 1
      ? imageModels.find((item) => item.id === next[0])?.maxReferences || maxRefs
      : minMaxReferences(next, imageModels));
  }

  function toggleImageModel(id: string) {
    const next = imageModelIds.includes(id)
      ? imageModelIds.filter((item) => item !== id)
      : [...imageModelIds, id];
    if (!next.length) return;
    applyImageModels(next);
  }

  function applyVariants(value: number) {
    setVariants(value);
    writeStoredVariants(value);
  }

  function selectResult(record: PosterRecord) {
    setResult(record);
    if (record.styleId) {
      setActiveStyleId(record.styleId);
      setSpecs((current) => ({ ...current, [record.styleId]: record.spec }));
    }
    setSentRefs(savedModelRefs(record));
  }

  const modelOptions = [
    ...imageModels,
    ...imageModelIds
      .filter((id) => !imageModels.some((item) => item.id === id))
      .map((id) => ({ id, name: id, maxReferences: maxRefs })),
  ];

  const lastIndex = Math.max(1, (context?.latlng.length ?? 2) - 1);
  const croppedKm = trackDistanceM(croppedLatLng);
  const busy = planning || generating;
  const plannedStyleIds = styleIds.filter((id) => specs[id]);
  const specStyleId = specs[activeStyleId] ? activeStyleId : plannedStyleIds[0];
  const spec = specStyleId ? specs[specStyleId] ?? null : null;
  const allThemesPlanned = styleIds.length > 0 && styleIds.every((id) => specs[id]);
  const generateCount = plannedStyleIds.length * imageModelIds.reduce(
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
  const resultCost = result
    ? formatCostBreakdown({ promptCost: result.promptCost, cost: result.cost })
    : "";
  const runsBatchCost = formatBatchCost(modelRuns);
  const compareStyles = new Set(batchResults.map((item) => item.styleId)).size > 1;
  const compareModels = new Set(batchResults.map((item) => item.model)).size > 1;
  const compareItems = batchResults.length ? batchResults : result ? [result] : [];
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
          compareStyles ? styleLabel(item.styleId, item.spec.style.name) : null,
          compareModels || !compareStyles ? shortModelLabel(item.model, item.modelName) : null,
          posterVariantLabel(item, compareItems),
          item.durationMs != null ? formatDurationMs(item.durationMs) : null,
        ]
          .filter(Boolean)
          .join(" · ") || "result",
    })),
  ];

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

  return (
    <>
    <aside className="panel poster-panel">
      <div className="panel-block poster-head">
        <div>
          <div className="eyebrow">Poster</div>
          <strong>{context?.activity.name ?? "Create poster"}</strong>
        </div>
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {loading && (
        <div className="panel-block">
          <p className="muted">Loading nearby features…</p>
        </div>
      )}
      {error && (
        <div className="panel-block">
          <p className="error">{error}</p>
        </div>
      )}
      {context && !loading && (
        <div className="poster-body">
          <div className="panel-block">
            <div className="eyebrow">Crop track</div>
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
            <p className="muted">
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
          </div>

          <div className="panel-block">
            <div className="eyebrow">Geography</div>
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

          <div className="panel-block">
            <div className="eyebrow">Landmarks</div>
            {catalog
              .filter((item) => item.group === "landmarks")
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
            <div className="chip-row">
              {selectedNamedAreas.map((area) => (
                <button
                  key={`area-${area.name}`}
                  type="button"
                  className="chip on"
                  title={`Wash ${area.letter} on the schematic`}
                  onClick={() => setAreaNames((current) => current.filter((name) => name !== area.name))}
                >
                  {area.letter} {area.name} ×
                </button>
              ))}
              {selectedNamedWays.map((trail) => (
                <TrailChip
                  key={`trail-${trailSourceName(trail.name, trailAliases)}`}
                  trail={trail}
                  editing={editingTrail === trail.name}
                  draft={editingTrail === trail.name ? editingTrailName : trail.name}
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
                  onRemove={() => removeTrail(trail.name)}
                />
              ))}
              {selectedPois.map((poi, index) => (
                <button
                  key={`${poi.name}-${poi.lat}`}
                  type="button"
                  className="chip on"
                  title={
                    poi.source === "user"
                      ? `Disc ${index + 1} · placed on the schematic`
                      : `Disc ${index + 1} on the schematic`
                  }
                  onClick={() => removePoi(poi.name)}
                >
                  {index + 1} {poi.name} ×
                </button>
              ))}
            </div>
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
              the schematic: Place landmark or Name stretch. Click a named stretch — or its chip —
              to rename a Strava or hand-named trail.
            </p>
            {landmarkHint && <p className="muted">{landmarkHint}</p>}
            {landmarkChoices?.map((poi) => (
              <button key={`${poi.name}-${poi.lat}`} type="button" className="chip" onClick={() => addCustom(poi)}>
                {poi.name}
              </button>
            ))}
          </div>

          <div className="panel-block">
            <div className="eyebrow">Themes</div>
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
              {styleIds.length > 1
                ? `${styleIds.length} themes will each get their own prompt`
                : "Select more than one to compare themes"}
            </p>
            {(editingCustom || singlePreset) && (
              <textarea
                className="poster-prompt"
                rows={5}
                value={editingCustom ? stylePrompt : styleById(styleIds[0]).prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  if (singlePreset) {
                    setStyleIds(["custom"]);
                    setActiveStyleId("custom");
                  }
                  setStylePrompt(value);
                }}
                placeholder="Custom style prompt"
              />
            )}
            {styleIds.length > 1 && editingCustom && (
              <p className="muted">Custom uses this prompt; other themes use their presets.</p>
            )}
          </div>

          <div className="panel-block">
            <div className="eyebrow">Stats on poster</div>
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
          </div>

          <div className="panel-block">
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
            <div className="poster-field">
              Image models
              <div className="model-list">
                {modelOptions.map((item) => (
                  <label key={item.id} className="check">
                    <input
                      type="checkbox"
                      checked={imageModelIds.includes(item.id)}
                      onChange={() => toggleImageModel(item.id)}
                      disabled={!modelOptions.length}
                    />
                    <span>
                      {item.name}
                      <em>{item.id !== item.name ? item.id : ""}</em>
                    </span>
                  </label>
                ))}
              </div>
              <p className="muted">
                {imageModelIds.length > 1
                  ? `${imageModelIds.length} models will generate in parallel`
                  : "Select more than one to compare outputs"}
                {variantCaps.length
                  ? ` · ${variantCaps.join(" · ")}`
                  : variants > 1
                    ? ` · ${variants} images per prompt, one request`
                    : ""}
              </p>
            </div>
            {schematicUrl ? (
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
            <p className="muted">
              {sentRefsHint(
                maxRefs,
                Boolean(satelliteUrl),
                maxRefs >= 2 && Boolean(schematicUrl) && !satelliteUrl,
              )}
            </p>
            {context.warnings.length ? <p className="muted">{context.warnings.join(" · ")}</p> : null}
          </div>

          <div className="panel-block">
            <button className="button" type="button" disabled={busy || !title.trim() || !styleIds.length} onClick={() => void handlePlan()}>
              {planning
                ? planProgress.total > 1
                  ? `Planning ${planProgress.done}/${planProgress.total}… ${elapsed}s`
                  : `Planning… ${elapsed}s`
                : plannedStyleIds.length
                  ? styleIds.length > 1
                    ? "Re-plan prompts"
                    : "Re-plan"
                  : styleIds.length > 1
                    ? "Plan prompts"
                    : "Plan prompt"}
            </button>
            {plannedStyleIds.length > 0 && !allThemesPlanned && (
              <p className="muted">Plan prompts for the newly selected themes before generating.</p>
            )}
          </div>

          {spec && (
            <div className="panel-block">
              {plannedStyleIds.length > 1 && (
                <div className="chip-row">
                  {plannedStyleIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`chip ${id === specStyleId ? "on" : ""}`}
                      onClick={() => setActiveStyleId(id)}
                    >
                      {styleLabel(id, specs[id]?.style.name)}
                    </button>
                  ))}
                </div>
              )}
              <SpecEditor
                spec={spec}
                onChange={(next) =>
                  setSpecs((current) => ({ ...current, [specStyleId ?? activeStyleId]: next }))
                }
              />
              <button
                className="button"
                type="button"
                disabled={busy || !imageModelIds.length || !allThemesPlanned}
                onClick={() => void handleGenerate()}
              >
                {generating
                  ? generateProgress.total > 1
                    ? `Generating ${generateProgress.done}/${generateProgress.total}… ${elapsed}s`
                    : generateCount > 1
                      ? `Generating ${generateCount} variants… ${elapsed}s`
                      : `Generating… ${elapsed}s`
                  : generateCount > 1
                    ? styleIds.length > 1 || imageModelIds.length > 1
                      ? `Generate ${[
                          styleIds.length > 1 ? `${styleIds.length} themes` : null,
                          imageModelIds.length > 1 ? `${imageModelIds.length} models` : null,
                        ]
                          .filter(Boolean)
                          .join(" × ")} (${generateCount} variants)`
                      : `Generate ${generateCount} variants`
                    : "Generate poster"}
              </button>
              {modelRuns.length > 0 && (
                <ul className="model-times">
                  {modelRuns.map((run) => {
                    const ms = (run.finishedAt ?? Date.now()) - run.startedAt;
                    const time = formatDurationMs(ms);
                    const status = run.error ? "failed" : run.finishedAt ? "done" : "running";
                    const showStyle = styleIds.length > 1;
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
            </div>
          )}

          {result && (
            <div className="panel-block">
              <div className="eyebrow">{batchResults.length > 1 ? "Compare results" : "Result"}</div>
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
                        compareStyles ? styleLabel(item.styleId, item.spec.style.name) : null,
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
                <a className="text-btn" href={result.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              <p className="muted">
                {styleLabel(result.styleId, result.spec.style.name)}
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
              <textarea
                className="poster-prompt"
                rows={3}
                placeholder="Refine: brighter trail, bigger title…"
                value={refineNotes}
                onChange={(event) => setRefineNotes(event.target.value)}
              />
              <button
                className="text-btn"
                type="button"
                disabled={busy || !refineNotes.trim()}
                onClick={() => void handlePlan()}
              >
                Re-plan with notes
              </button>
            </div>
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
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
