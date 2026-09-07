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
  type PosterContext,
  type PosterPoi,
  type PosterRecord,
  type PosterSpec,
} from "../api";
import { clampCrop, isClosedLoop, paddedBbox, schematicBbox, sliceTrack, snapIndex, snapRadius, trackDistanceM } from "./crop";
import { FEATURE_CATALOG, DEFAULT_FEATURE_IDS, type FeatureOption } from "./featureCatalog";
import { planContactSheets, renderContactSheets, type GroundingLayer } from "./grounding/contactSheet";
import { renderSchematicDataUrl, type AspectRatio } from "./grounding/renderSchematic";
import { MAX_LABELS, prioritizeLabels } from "./labels";
import { SpecEditor } from "./SpecEditor";
import {
  formatDurationMs,
  minMaxReferences,
  readStoredImageModels,
  shortModelLabel,
  writeStoredImageModels,
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
  error?: string;
};

function initialStyleId(record?: PosterRecord | null) {
  const id = record?.styleId;
  if (id && POSTER_STYLES.some((item) => item.id === id)) return id;
  if (record?.stylePrompt) return "custom";
  return DEFAULT_POSTER_STYLE.id;
}

const ASPECTS: AspectRatio[] = ["2:3", "3:4", "1:1", "4:3", "16:9"];

const SCHEMATIC_LEGEND =
  "red = route; grey = roads; blue = water; green = forest; numbered discs = private location index, do not copy";

const ROUTE_ONLY_LEGEND =
  "same red line as the schematic, geography removed; every separate stroke is a required segment, including parallels and shore hugs";

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
  routeOnlyUrl: string | null,
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
  if (maxRefs >= 2 && routeOnlyUrl) {
    layers.push({
      role: "route-only",
      legend: ROUTE_ONLY_LEGEND,
      dataUrl: routeOnlyUrl,
    });
  }
  return layers;
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
  refineFrom?: PosterRecord | null;
  dismissPoi?: { name: string; nonce: number } | null;
};

export function PosterPanel({
  activityId,
  features,
  onClose,
  onCropChange,
  onStopsChange,
  onPoisChange,
  refineFrom,
  dismissPoi,
}: Props) {
  const catalog = FEATURE_CATALOG.map(
    (item) => features.find((feature) => feature.id === item.id) ?? item,
  );
  const [context, setContext] = useState<PosterContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureIds, setFeatureIds] = useState<string[]>(DEFAULT_FEATURE_IDS);
  const [styleIds, setStyleIds] = useState<string[]>(() => [initialStyleId(refineFrom)]);
  const [stylePrompt, setStylePrompt] = useState(refineFrom?.stylePrompt || DEFAULT_POSTER_STYLE.prompt);
  const [activeStyleId, setActiveStyleId] = useState(() => initialStyleId(refineFrom));
  const [title, setTitle] = useState("");
  const [statIds, setStatIds] = useState<string[]>(["title", "date", "distance", "movingTime"]);
  const [labels, setLabels] = useState<string[]>([]);
  const [customPois, setCustomPois] = useState<PosterPoi[]>([]);
  const [cropStart, setCropStart] = useState(0);
  const [cropEnd, setCropEnd] = useState(1);
  const [showRouteMarkers, setShowRouteMarkers] = useState(true);
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [landmarkChoices, setLandmarkChoices] = useState<PosterPoi[] | null>(null);
  const [landmarkHint, setLandmarkHint] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("2:3");
  const [schematicUrl, setSchematicUrl] = useState<string | null>(null);
  const [routeOnlyUrl, setRouteOnlyUrl] = useState<string | null>(null);
  const [modelRefs, setModelRefs] = useState<ModelRef[]>([]);
  const [sentRefs, setSentRefs] = useState<ModelRef[]>([]);
  const [maxRefs, setMaxRefs] = useState(3);
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([]);
  const [imageModelIds, setImageModelIds] = useState(() => {
    const stored = readStoredImageModels();
    return refineFrom?.model && !stored.includes(refineFrom.model)
      ? [...stored, refineFrom.model]
      : stored;
  });
  const [specs, setSpecs] = useState<Partial<Record<string, PosterSpec>>>(() => {
    const id = initialStyleId(refineFrom);
    return refineFrom?.spec ? { [id]: refineFrom.spec } : {};
  });
  const [planning, setPlanning] = useState(false);
  const [planProgress, setPlanProgress] = useState({ done: 0, total: 0 });
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });
  const [modelRuns, setModelRuns] = useState<GenerationRun[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<PosterRecord | null>(null);
  const [batchResults, setBatchResults] = useState<PosterRecord[]>([]);
  const [refineNotes, setRefineNotes] = useState("");
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
    fetchPosterContext(activityId, featureIds)
      .then((next) => {
        if (cancelled) return;
        setContext(next);
        setLabels(next.pois.map((poi) => poi.name));
        if (activityChanged) {
          cropActivityId.current = activityId;
          setTitle(next.activity.name || "Ride");
          setCropStart(0);
          setCropEnd(Math.max(1, next.latlng.length - 1));
          if (refineFrom) {
            setStatIds(refineFrom.stats.map((item) => item.label.toLowerCase().replace(/\s+/g, "")));
            setSentRefs(savedModelRefs(refineFrom));
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
    return prioritizeLabels(suggested, customPois);
  }, [context, labels, customPois]);

  const displayBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return context?.bbox ?? null;
    return paddedBbox(croppedLatLng, selectedPois);
  }, [context, croppedLatLng, selectedPois]);
  const groundingBbox = useMemo(() => {
    if (croppedLatLng.length < 2) return displayBbox;
    return schematicBbox(croppedLatLng, selectedPois);
  }, [croppedLatLng, selectedPois, displayBbox]);

  const selectedStats = useMemo(() => {
    const available = context?.stats ?? [];
    const extras: FormattedStat[] = title
      ? [{ id: "title", label: "Title", value: title }, ...available.filter((item) => item.id !== "title")]
      : available;
    return extras.filter((item) => statIds.includes(item.id) || (item.id === "title" && statIds.includes("title")));
  }, [context, statIds, title]);

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

  const removePoi = useCallback((name: string) => {
    setCustomPois((current) => current.filter((item) => item.name !== name));
    setLabels((current) => current.filter((item) => item !== name));
  }, []);

  useEffect(() => {
    if (!dismissPoi?.name) return;
    removePoi(dismissPoi.name);
  }, [dismissPoi, removePoi]);

  useEffect(
    () => () => {
      onCropChange?.(null);
      onStopsChange?.([]);
    },
    [onCropChange, onStopsChange],
  );

  useEffect(() => {
    if (croppedLatLng.length < 2 || !groundingBbox) {
      setSchematicUrl(null);
      setRouteOnlyUrl(null);
      return;
    }
    try {
      setSchematicUrl(
        renderSchematicDataUrl({
          latlng: croppedLatLng,
          bbox: groundingBbox,
          ways: context?.ways,
          pois: selectedPois,
          aspectRatio,
          layers: {
            roads: featureIds.includes("major-roads"),
            streets: featureIds.includes("streets"),
            paths: featureIds.includes("paths"),
            rail: featureIds.includes("rail"),
            water: featureIds.includes("lakes") || featureIds.includes("rivers"),
            forest: featureIds.includes("forest"),
            parks: featureIds.includes("parks"),
            farmland: featureIds.includes("farmland"),
            cemeteries: featureIds.includes("cemeteries"),
            labels: true,
            routeMarkers: routeMarkerMode(showRouteMarkers, croppedLatLng),
          },
        }),
      );
      setRouteOnlyUrl(
        renderSchematicDataUrl({
          latlng: croppedLatLng,
          bbox: groundingBbox,
          aspectRatio,
          silhouette: true,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not render schematic");
    }
  }, [context, croppedLatLng, groundingBbox, selectedPois, aspectRatio, featureIds.join(","), showRouteMarkers]);

  useEffect(() => {
    const layers = groundingLayers(schematicUrl, routeOnlyUrl, maxRefs, croppedLatLng, showRouteMarkers);
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
  }, [schematicUrl, routeOnlyUrl, maxRefs, aspectRatio, showRouteMarkers, croppedLatLng]);

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

  async function buildGrounding(): Promise<GroundingLayer[]> {
    return groundingLayers(schematicUrl, routeOnlyUrl, maxRefs, croppedLatLng, showRouteMarkers);
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
            return { styleId: style.id, spec: planned.spec };
          } catch (err) {
            return {
              styleId: style.id,
              error: err instanceof Error ? err.message : "Planner failed",
            };
          } finally {
            setPlanProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }),
      );
      const planned = settled.flatMap((item) => (item.spec ? [{ styleId: item.styleId, spec: item.spec }] : []));
      const failures = settled.flatMap((item) =>
        item.error ? [`${styleLabel(item.styleId)}: ${item.error}`] : [],
      );
      if (!planned.length) throw new Error(failures.join(" · ") || "Planner failed");
      setSpecs((current) => {
        const next = { ...current };
        for (const item of planned) next[item.styleId] = item.spec;
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
      const batchId = jobs.length > 1 ? crypto.randomUUID() : undefined;
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
        })),
      );
      const settled = await Promise.all(
        jobs.map(async (job) => {
          try {
            const record = await generatePoster({
              activityId,
              spec: job.spec,
              references: packed.map((item) => item.dataUrl),
              refineNotes: refineNotes || undefined,
              featureIds,
              labels: selectedPois.map((poi) => poi.name),
              stats: selectedStats.map((item) => ({ label: item.label, value: item.value })),
              styleId: job.styleId,
              stylePrompt: job.style.id === "custom" ? stylePrompt : job.style.prompt,
              aspectRatio,
              batchId,
              model: job.model,
            });
            setModelRuns((current) =>
              current.map((run) =>
                run.key === job.key ? { ...run, finishedAt: Date.now() } : run,
              ),
            );
            return { key: job.key, styleId: job.styleId, model: job.model, record };
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
      const records = settled.flatMap((item) => (item.record ? [item.record] : []));
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
  const generateCount = plannedStyleIds.length * imageModelIds.length;
  const editingCustom = styleIds.includes("custom");
  const singlePreset = styleIds.length === 1 && styleIds[0] !== "custom";
  const compareStyles = new Set(batchResults.map((item) => item.styleId)).size > 1;
  const compareModels = new Set(batchResults.map((item) => item.model)).size > 1;
  const compareItems = batchResults.length ? batchResults : result ? [result] : [];
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
    if (!compareOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setCompareOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareOpen]);

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
            {showRouteMarkers && (
              <p className="muted">
                {isClosedLoop(croppedLatLng)
                  ? "Start and finish are the same place — one combined marker"
                  : "Green start · black finish"}
              </p>
            )}
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
              {selectedPois.map((poi, index) => (
                <button
                  key={`${poi.name}-${poi.lat}`}
                  type="button"
                  className="chip on"
                  title={`Disc ${index + 1} on the schematic`}
                  onClick={() => removePoi(poi.name)}
                >
                  {index + 1} {poi.name} ×
                </button>
              ))}
            </div>
            {selectedPois.length > 0 && (
              <p className="muted">
                Numbered discs are a location index for the image model only. The poster should show
                the place names on the map, not the numbers or a legend.
              </p>
            )}
            {selectedPois.length > MAX_LABELS && (
              <p className="warn">
                {selectedPois.length} labels selected. Image models often drop, merge, or misspell
                names past {MAX_LABELS}.
              </p>
            )}
            <form className="poster-lookup" onSubmit={(event) => void handleLookup(event)}>
              <input
                className="search"
                value={landmarkQuery}
                onChange={(event) => setLandmarkQuery(event.target.value)}
                placeholder="Add a landmark"
                disabled={lookingUp}
              />
              <button className="text-btn" type="submit" disabled={lookingUp || !landmarkQuery.trim()}>
                {lookingUp ? "Looking up…" : "Add"}
              </button>
            </form>
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
            {(context.stats.length
              ? [{ id: "title", label: "Title", value: title }, ...context.stats.filter((item) => item.id !== "title")]
              : [{ id: "title", label: "Title", value: title }]
            ).map((stat) => (
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
              </p>
            </div>
            {schematicUrl ? (
              <div className="preview-grid">
                <figure className="poster-ref-card">
                  <img className="poster-ref" src={schematicUrl} alt="schematic grounding" />
                  <figcaption>schematic</figcaption>
                </figure>
                {maxRefs >= 2 && routeOnlyUrl && (
                  <figure className="poster-ref-card">
                    <img className="poster-ref" src={routeOnlyUrl} alt="route-only grounding" />
                    <figcaption>route-only</figcaption>
                  </figure>
                )}
              </div>
            ) : null}
            <p className="muted">
              {maxRefs >= 2 && routeOnlyUrl
                ? "2 references will be sent: schematic + route-only"
                : "1 schematic reference will be sent"}
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
                    : `Generating… ${elapsed}s`
                  : generateCount > 1
                    ? styleIds.length > 1 && imageModelIds.length > 1
                      ? `Generate ${styleIds.length} themes × ${imageModelIds.length} models`
                      : styleIds.length > 1
                        ? `Generate ${styleIds.length} themes`
                        : `Generate with ${imageModelIds.length} models`
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
                          {run.error ? " · failed" : ""}
                        </span>
                      </li>
                    );
                  })}
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
                {result.cost != null ? ` · $${result.cost.toFixed(3)}` : ""}
              </p>
              {sentRefs.length > 0 && (
                <>
                  <div className="eyebrow">Sent to the model</div>
                  <div className="preview-grid">
                    {sentRefs.map((item, index) => (
                      <figure key={`${item.role}-${index}`} className="poster-ref-card">
                        <img className="poster-ref" src={item.dataUrl} alt={item.role} />
                        <figcaption>{item.role}</figcaption>
                      </figure>
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
