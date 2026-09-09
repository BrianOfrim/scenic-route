import type { NamedWay, PosterPoi, PosterRecord, PosterSpec } from "../api";
import { clampCrop } from "./crop";
import { DEFAULT_FEATURE_IDS } from "./featureCatalog";
import type { AspectRatio } from "./grounding/renderSchematic";
import { DEFAULT_POSTER_STYLE, POSTER_STYLES } from "./styles";

const ASPECTS: AspectRatio[] = ["2:3", "3:4", "1:1", "4:3", "16:9"];

export type PosterEditorSnapshot = {
  featureIds: string[];
  labels: string[];
  trailNames: string[];
  trailAliases: Record<string, string>;
  areaNames: string[];
  customPois: PosterPoi[];
  customWays: NamedWay[];
  cropStart: number;
  cropEnd: number;
  showRouteMarkers: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  imageModelIds: string[];
  variants: number;
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
};

export type EditorCapture = {
  featureIds: string[];
  labels: string[];
  trailNames: string[];
  trailAliases: Record<string, string>;
  areaNames: string[];
  customPois: PosterPoi[];
  customWays: NamedWay[];
  cropStart: number;
  cropEnd: number;
  showRouteMarkers: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  imageModelIds: string[];
  variants: number;
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
};

export function asAspectRatio(value?: string | null): AspectRatio {
  return ASPECTS.includes(value as AspectRatio) ? (value as AspectRatio) : "2:3";
}

export function styleIdFromRecord(record?: PosterRecord | null) {
  const id = record?.styleId;
  if (id && POSTER_STYLES.some((item) => item.id === id)) return id;
  if (record?.stylePrompt) return "custom";
  return DEFAULT_POSTER_STYLE.id;
}

export function statIdFromLabel(label: string) {
  const key = label.trim().toLowerCase();
  if (key.startsWith("start")) return "startPlace";
  if (key.startsWith("finish")) return "finishPlace";
  return key.replace(/\s+/g, "");
}

export function captureEditorSnapshot(input: EditorCapture): PosterEditorSnapshot {
  return {
    featureIds: [...input.featureIds],
    labels: [...input.labels],
    trailNames: [...input.trailNames],
    trailAliases: { ...input.trailAliases },
    areaNames: [...input.areaNames],
    customPois: input.customPois.map((item) => ({ ...item })),
    customWays: input.customWays.map((item) => ({ ...item })),
    cropStart: input.cropStart,
    cropEnd: input.cropEnd,
    showRouteMarkers: input.showRouteMarkers,
    title: input.title,
    startPlace: input.startPlace,
    finishPlace: input.finishPlace,
    placesEdited: input.placesEdited,
    statIds: [...input.statIds],
    aspectRatio: input.aspectRatio,
    styleIds: [...input.styleIds],
    stylePrompt: input.stylePrompt,
    imageModelIds: [...input.imageModelIds],
    variants: input.variants,
    specs: { ...input.specs },
    planCosts: { ...input.planCosts },
  };
}

export type RestoredEditor = {
  featureIds: string[];
  labels: string[];
  trailNames: string[];
  trailAliases: Record<string, string>;
  areaNames: string[];
  customPois: PosterPoi[];
  customWays: NamedWay[];
  cropStart: number;
  cropEnd: number;
  showRouteMarkers: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  imageModelIds: string[] | null;
  variants: number | null;
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
};

function savedStartFinish(record: PosterRecord) {
  const specStart = record.spec?.route.startName?.trim() ?? "";
  const specFinish = record.spec?.route.finishName?.trim() ?? "";
  const savedStart = specStart || record.stats.find((item) => /^start/i.test(item.label))?.value || "";
  const savedFinish = specFinish || record.stats.find((item) => /^finish$/i.test(item.label))?.value || "";
  return {
    startPlace: savedStart || savedFinish,
    finishPlace: savedFinish || savedStart,
  };
}

function snapshotOf(record: PosterRecord) {
  return record.editor && typeof record.editor === "object" ? record.editor : undefined;
}

export function editorSeed(record?: PosterRecord | null) {
  if (!record) return null;
  const restored = restoreEditor(record, 2, {
    title: record.title || "",
    labels: [],
    trailNames: [],
    areaNames: [],
  });
  return {
    featureIds: restored.featureIds,
    styleIds: restored.styleIds,
    stylePrompt: restored.stylePrompt,
    aspectRatio: restored.aspectRatio,
    title: restored.title,
    showRouteMarkers: restored.showRouteMarkers,
    imageModelIds: restored.imageModelIds,
    variants: restored.variants,
    specs: restored.specs,
    planCosts: restored.planCosts,
  };
}

export function restoreEditor(
  record: PosterRecord,
  trackLength: number,
  defaults: { title: string; labels: string[]; trailNames: string[]; areaNames: string[] },
): RestoredEditor {
  const editor = snapshotOf(record);
  const places = savedStartFinish(record);
  const styleId = styleIdFromRecord(record);
  const [cropStart, cropEnd] = clampCrop(
    trackLength,
    editor?.cropStart ?? 0,
    editor?.cropEnd ?? Math.max(1, trackLength - 1),
  );
  const startPlace = editor?.startPlace ?? places.startPlace;
  const finishPlace = editor?.finishPlace ?? places.finishPlace;
  return {
    featureIds: editor?.featureIds?.length
      ? editor.featureIds
      : record.featureIds.length
        ? record.featureIds
        : DEFAULT_FEATURE_IDS,
    labels: editor?.labels ?? (record.labels.length ? record.labels : defaults.labels),
    trailNames: editor?.trailNames ?? defaults.trailNames,
    trailAliases: editor?.trailAliases ?? {},
    areaNames: editor?.areaNames ?? defaults.areaNames,
    customPois: editor?.customPois ?? [],
    customWays: editor?.customWays ?? [],
    cropStart,
    cropEnd,
    showRouteMarkers: editor?.showRouteMarkers ?? true,
    title: editor?.title || record.title || defaults.title,
    startPlace,
    finishPlace,
    placesEdited: editor?.placesEdited ?? Boolean(startPlace || finishPlace),
    statIds: editor?.statIds?.length
      ? editor.statIds
      : record.stats.length
        ? record.stats
            .map((item) => statIdFromLabel(item.label))
            .filter((id) => id !== "startPlace" && id !== "finishPlace")
        : ["title", "date", "distance", "movingTime"],
    aspectRatio: asAspectRatio(editor?.aspectRatio || record.aspectRatio),
    styleIds: editor?.styleIds?.length ? editor.styleIds : [styleId],
    stylePrompt: editor?.stylePrompt || record.stylePrompt || DEFAULT_POSTER_STYLE.prompt,
    imageModelIds: editor?.imageModelIds?.length ? editor.imageModelIds : null,
    variants: editor?.variants ?? null,
    specs: {
      ...(editor?.specs ?? {}),
      ...(record.spec ? { [styleId]: record.spec } : {}),
    },
    planCosts: {
      ...(editor?.planCosts ?? {}),
      ...(record.promptCost != null ? { [styleId]: record.promptCost } : {}),
    },
  };
}
