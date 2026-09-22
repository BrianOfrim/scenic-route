import type { NamedWay, PosterPoi, PosterRecord, PosterSpec } from "../api";
import { clampCrop } from "./crop";
import { DEFAULT_FEATURE_IDS, FEATURE_CATALOG } from "./featureCatalog";
import type { AspectRatio } from "./grounding/renderSchematic";
import { AUTO_PALETTE_ID, DEFAULT_POSTER_STYLE, POSTER_STYLES, planSlotKey, snapshotPaletteIds } from "./styles";

const NAMED_REGION_KINDS = new Set([
  "neighbourhood",
  "neighborhood",
  "quarter",
  "university",
  "college",
  "campus",
  "park",
  "nature_reserve",
]);

export type SavedSetupNames = {
  labels: string[];
  trailNames: string[];
  areaNames: string[];
};

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
  routeOnly: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  paletteId: string;
  paletteIdsByStyle: Record<string, string[]>;
  imageModelIds: string[];
  variants: number;
  qualities?: string[];
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
  landmarkNearM?: Record<string, number>;
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
  routeOnly?: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  paletteId?: string;
  paletteIdsByStyle?: Record<string, string[]>;
  imageModelIds: string[];
  variants: number;
  qualities?: string[];
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
  landmarkNearM?: Record<string, number>;
};

export function asAspectRatio(value?: string | null): AspectRatio {
  return ASPECTS.includes(value as AspectRatio) ? (value as AspectRatio) : "2:3";
}

function snapshotPalettes(
  styleIds: string[],
  paletteIdsByStyle?: Record<string, string[] | undefined> | null,
  legacyPaletteId?: string | null,
) {
  return snapshotPaletteIds(styleIds, paletteIdsByStyle, legacyPaletteId);
}

function firstPaletteId(styleIds: string[], paletteIdsByStyle: Record<string, string[]>) {
  return paletteIdsByStyle[styleIds[0]]?.[0] ?? Object.values(paletteIdsByStyle)[0]?.[0] ?? AUTO_PALETTE_ID;
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
  const paletteIdsByStyle = snapshotPalettes(input.styleIds, input.paletteIdsByStyle, input.paletteId);
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
    routeOnly: Boolean(input.routeOnly),
    title: input.title,
    startPlace: input.startPlace,
    finishPlace: input.finishPlace,
    placesEdited: input.placesEdited,
    statIds: [...input.statIds],
    aspectRatio: input.aspectRatio,
    styleIds: [...input.styleIds],
    stylePrompt: input.stylePrompt,
    paletteIdsByStyle,
    paletteId: firstPaletteId(input.styleIds, paletteIdsByStyle),
    imageModelIds: [...input.imageModelIds],
    variants: input.variants,
    qualities: input.qualities?.length ? [...input.qualities] : undefined,
    specs: { ...input.specs },
    planCosts: { ...input.planCosts },
    landmarkNearM: { ...(input.landmarkNearM ?? {}) },
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
  routeOnly: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: AspectRatio;
  styleIds: string[];
  stylePrompt: string;
  paletteId: string;
  paletteIdsByStyle: Record<string, string[]>;
  imageModelIds: string[] | null;
  variants: number | null;
  qualities: string[] | null;
  specs: Partial<Record<string, PosterSpec>>;
  planCosts: Partial<Record<string, number | null>>;
  landmarkNearM: Record<string, number>;
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

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function firstNonEmpty(...lists: Array<string[] | undefined>): string[] {
  for (const list of lists) {
    if (list?.length) return uniqueNames(list);
  }
  return [];
}

function splitNameList(text: string) {
  return text
    .split(/\s*(?:,|\band\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function looksLikePlaceName(name: string) {
  if (name.length < 2 || name.length > 80) return false;
  if (/^(an|a|the)\s/i.test(name)) return false;
  return /[A-Z]/.test(name[0] ?? "");
}

function slicePromptSection(prompt: string, heading: RegExp) {
  const match = heading.exec(prompt);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = prompt.slice(start);
  const end = rest.search(/\n\n|\nReference images:|\nTitle, exactly:|\nLandmarks:|\nAvoid:/);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

export function namesFromSpec(spec?: PosterSpec | null): SavedSetupNames {
  const labels: string[] = [];
  const trailNames: string[] = [];
  const areaNames: string[] = [];
  if (!spec) return { labels, trailNames, areaNames };
  for (const item of spec.landmarks ?? []) {
    if (item.name?.trim()) labels.push(item.name.trim());
  }
  for (const item of spec.geography ?? []) {
    const name = item.name?.trim();
    if (!name) continue;
    const kind = (item.kind ?? "").trim().toLowerCase();
    const isTrail = Boolean(item.color) || kind === "trail" || kind === "path";
    const isArea = Boolean(item.letter) || NAMED_REGION_KINDS.has(kind);
    if (isTrail) trailNames.push(name);
    else if (isArea) areaNames.push(name);
    else labels.push(name);
  }
  return {
    labels: uniqueNames(labels),
    trailNames: uniqueNames(trailNames),
    areaNames: uniqueNames(areaNames),
  };
}

export function namesFromPrompt(prompt?: string | null): SavedSetupNames {
  const labels: string[] = [];
  const trailNames: string[] = [];
  const areaNames: string[] = [];
  if (!prompt) return { labels, trailNames, areaNames };

  const geography = slicePromptSection(prompt, /(?:^|\n)Geography:\s*/);
  if (geography) {
    for (const match of geography.matchAll(/labeled district\s+(.+?)\s*\(/gi)) {
      areaNames.push(match[1].trim());
    }
    for (const match of geography.matchAll(/(?:^|;\s+)(?:named )?(?:path|trail)\s+(.+?)\s*\(/gi)) {
      trailNames.push(match[1].trim());
    }
  }

  const landmarks = slicePromptSection(prompt, /(?:^|\n)Landmarks:\s*/) || slicePromptSection(prompt, /Label these landmarks[^:]*:\s*/i);
  if (landmarks) {
    for (const match of landmarks.matchAll(/"([^"]+)"/g)) {
      const name = match[1].trim();
      if (/\b(park|reserve|campus|university|college|recreation)\b/i.test(name)) areaNames.push(name);
      else labels.push(name);
    }
  }

  if (!labels.length && !trailNames.length && !areaNames.length) {
    const lettered = prompt.match(/hand-lettered names for ([^.]+)\./i);
    if (lettered) labels.push(...splitNameList(lettered[1]).filter(looksLikePlaceName));
  }

  const areas = new Set(uniqueNames(areaNames).map((name) => name.toLowerCase()));
  const trails = new Set(uniqueNames(trailNames).map((name) => name.toLowerCase()));
  return {
    labels: uniqueNames(labels).filter((name) => !areas.has(name.toLowerCase()) && !trails.has(name.toLowerCase())),
    trailNames: uniqueNames(trailNames),
    areaNames: uniqueNames(areaNames),
  };
}

export function savedSetupNames(record: PosterRecord): SavedSetupNames {
  const editor = snapshotOf(record);
  const fromEditor =
    editor && (editor.labels.length > 0 || editor.trailNames.length > 0 || editor.areaNames.length > 0);
  if (fromEditor && editor) {
    return {
      labels: uniqueNames(editor.labels),
      trailNames: uniqueNames(editor.trailNames),
      areaNames: uniqueNames(editor.areaNames),
    };
  }
  const spec = namesFromSpec(record.spec);
  const prompt = namesFromPrompt(record.spec?.finalPrompt || record.prompt);
  return {
    labels: firstNonEmpty(record.labels, spec.labels, prompt.labels),
    trailNames: firstNonEmpty(spec.trailNames, prompt.trailNames),
    areaNames: firstNonEmpty(spec.areaNames, prompt.areaNames),
  };
}

export function featureIdsToResolveNames(featureIds: string[], names: SavedSetupNames): string[] {
  const ids = [...new Set((featureIds.length ? featureIds : DEFAULT_FEATURE_IDS).map((id) =>
    id === "strava-segments" ? "named-trails" : id,
  ))];
  const hasLandmark = ids.some((id) => FEATURE_CATALOG.some((item) => item.id === id && item.group === "landmarks"));
  const need = names.labels.length > 0 || names.trailNames.length > 0 || names.areaNames.length > 0;
  if (hasLandmark || !need) return ids;
  const extra = new Set<string>();
  if (names.areaNames.length) {
    extra.add("named-parks");
    extra.add("neighbourhoods");
    extra.add("colleges");
  }
  if (names.trailNames.length) extra.add("named-trails");
  if (names.labels.length) {
    extra.add("playgrounds");
    extra.add("peaks");
    extra.add("named-parks");
    extra.add("viewpoints");
    extra.add("historic");
    extra.add("towns");
    extra.add("structures");
    extra.add("schools");
    extra.add("colleges");
  }
  for (const item of FEATURE_CATALOG) {
    if (extra.has(item.id) && !ids.includes(item.id)) ids.push(item.id);
  }
  return ids;
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
    labels: restored.labels,
    trailNames: restored.trailNames,
    areaNames: restored.areaNames,
    styleIds: restored.styleIds,
    stylePrompt: restored.stylePrompt,
    paletteId: restored.paletteId,
    paletteIdsByStyle: restored.paletteIdsByStyle,
    aspectRatio: restored.aspectRatio,
    title: restored.title,
    showRouteMarkers: restored.showRouteMarkers,
    routeOnly: restored.routeOnly,
    imageModelIds: restored.imageModelIds,
    variants: restored.variants,
    qualities: restored.qualities,
    specs: restored.specs,
    planCosts: restored.planCosts,
    landmarkNearM: restored.landmarkNearM,
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
  const saved = savedSetupNames(record);
  const [cropStart, cropEnd] = clampCrop(
    trackLength,
    editor?.cropStart ?? 0,
    editor?.cropEnd ?? Math.max(1, trackLength - 1),
  );
  const startPlace = editor?.startPlace ?? places.startPlace;
  const finishPlace = editor?.finishPlace ?? places.finishPlace;
  const fromEditor =
    editor && (editor.labels.length > 0 || editor.trailNames.length > 0 || editor.areaNames.length > 0);
  return {
    featureIds: featureIdsToResolveNames(
      editor?.featureIds?.length ? editor.featureIds : record.featureIds,
      saved,
    ),
    labels: fromEditor && editor ? editor.labels : saved.labels,
    trailNames: fromEditor && editor ? editor.trailNames : saved.trailNames,
    trailAliases: editor?.trailAliases ?? {},
    areaNames: fromEditor && editor ? editor.areaNames : saved.areaNames,
    customPois: editor?.customPois ?? [],
    customWays: editor?.customWays ?? [],
    cropStart,
    cropEnd,
    showRouteMarkers: editor?.showRouteMarkers ?? true,
    routeOnly: editor?.routeOnly === true,
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
    paletteIdsByStyle: snapshotPalettes(
      editor?.styleIds?.length ? editor.styleIds : [styleId],
      editor?.paletteIdsByStyle,
      editor?.paletteId,
    ),
    paletteId: firstPaletteId(
      editor?.styleIds?.length ? editor.styleIds : [styleId],
      snapshotPalettes(
        editor?.styleIds?.length ? editor.styleIds : [styleId],
        editor?.paletteIdsByStyle,
        editor?.paletteId,
      ),
    ),
    imageModelIds: editor?.imageModelIds?.length ? editor.imageModelIds : null,
    variants: editor?.variants ?? null,
    qualities: editor?.qualities?.length ? editor.qualities : null,
    specs: {
      ...(editor?.specs ?? {}),
      ...(record.spec
        ? {
            [styleId]: record.spec,
            [planSlotKey(styleId, record.paletteId ?? AUTO_PALETTE_ID)]: record.spec,
          }
        : {}),
    },
    planCosts: {
      ...(editor?.planCosts ?? {}),
      ...(record.promptCost != null
        ? {
            [styleId]: record.promptCost,
            [planSlotKey(styleId, record.paletteId ?? AUTO_PALETTE_ID)]: record.promptCost,
          }
        : {}),
    },
    landmarkNearM: { ...(editor?.landmarkNearM ?? {}) },
  };
}
