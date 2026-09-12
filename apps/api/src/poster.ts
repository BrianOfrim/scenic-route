import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { revisePosterPrompt } from "./modifyPrompt";
import { createImage, listImageModels, maxImageOutputs, maxImageReferences, resolveImageModel } from "./openrouter";
import { POSTERS_DIR, isSafePosterId, posterPath } from "./paths";
import { specToImagePrompt, validatePosterSpec, type PosterSpec } from "./posterSpec";

export class PosterError extends Error {
  readonly status: 400 | 401 | 404 | 502 | 504;
  constructor(message: string, status: 400 | 401 | 404 | 502 | 504 = 400) {
    super(message);
    this.name = "PosterError";
    this.status = status;
  }
}

export type PosterRecord = {
  posterId: string;
  activityId: number;
  title: string;
  subtitle: string;
  spec: PosterSpec;
  prompt: string;
  model: string;
  modelName?: string;
  batchId?: string;
  aspectRatio: string;
  cost: number | null;
  promptCost?: number | null;
  durationMs?: number;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  featureIds: string[];
  labels: string[];
  stats: Array<{ label: string; value: string }>;
  styleId: string;
  stylePrompt: string;
  paletteId?: string;
  referenceCount: number;
  variant?: number;
  url: string;
  favorited?: boolean;
  editor?: PosterEditorSnapshot;
};

export type PosterEditorSnapshot = {
  featureIds: string[];
  labels: string[];
  trailNames: string[];
  trailAliases: Record<string, string>;
  areaNames: string[];
  customPois: unknown[];
  customWays: unknown[];
  cropStart: number;
  cropEnd: number;
  showRouteMarkers: boolean;
  routeOnly: boolean;
  title: string;
  startPlace: string;
  finishPlace: string;
  placesEdited: boolean;
  statIds: string[];
  aspectRatio: string;
  styleIds: string[];
  stylePrompt: string;
  paletteId: string;
  paletteIdsByStyle: Record<string, string[]>;
  imageModelIds: string[];
  variants: number;
  specs?: Record<string, PosterSpec>;
  planCosts?: Record<string, number | null>;
};

export const DEFAULT_VARIANTS = 4;
export const MAX_VARIANTS = 10;

export function clampVariants(value?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VARIANTS;
  return Math.min(MAX_VARIANTS, Math.max(1, Math.round(n)));
}

export function variantCount(requested: number | undefined, maxImages: number) {
  const allowed = Number.isFinite(maxImages) ? Math.max(1, Math.round(maxImages)) : 1;
  return Math.min(clampVariants(requested), allowed);
}

export type GeneratePosterBody = {
  activityId: number;
  spec: unknown;
  references: string[];
  /** When set, skip assembling a prompt from the spec. */
  prompt?: string;
  /** Grounding images to persist as ref-N.png. Defaults to `references`. */
  persistReferences?: string[];
  previousPosterId?: string;
  refineNotes?: string;
  featureIds?: string[];
  labels?: string[];
  stats?: Array<{ label: string; value: string }>;
  styleId?: string;
  stylePrompt?: string;
  paletteId?: string;
  aspectRatio?: string;
  model?: string;
  batchId?: string;
  variants?: number;
  promptCost?: number | null;
  editor?: unknown;
  label?: string;
};

export type ModifyPosterBody = {
  posterId: string;
  request: string;
  variants?: number;
  model?: string;
};

export function resolveImagePrompt(spec: PosterSpec, override?: string) {
  const trimmed = override?.trim() ?? "";
  return trimmed || specToImagePrompt(spec);
}

export function pngDataUrl(bytes: Buffer, mime = "image/png") {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function dataUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

/** Previous poster first, then saved grounding, capped to the model's ref limit. */
export function modifyImageReferences(previousPosterUrl: string, groundingUrls: string[], maxRefs: number) {
  const limit = Number.isFinite(maxRefs) ? Math.max(1, Math.round(maxRefs)) : 1;
  return [previousPosterUrl, ...groundingUrls].filter((item) => item.trim()).slice(0, limit);
}

export function readPosterGroundingUrls(posterId: string, referenceCount: number): string[] {
  const urls: string[] = [];
  for (let index = 1; index <= referenceCount; index += 1) {
    try {
      urls.push(pngDataUrl(readPosterRef(posterId, index)));
    } catch {
      break;
    }
  }
  return urls;
}

export function decodeDataUrl(url: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url.trim());
  if (!match) throw new PosterError("reference images must be base64 data URLs");
  if (!match[1].startsWith("image/")) throw new PosterError("reference images must be image data URLs");
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

export function newPosterId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export async function generatePoster(body: GeneratePosterBody): Promise<PosterRecord[]> {
  const activityId = Number(body.activityId);
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new PosterError("activityId is required");
  }
  const spec = validatePosterSpec(body.spec);
  const model = resolveImageModel(body.model);
  const listed = await listImageModels();
  const modelName = listed.find((item) => item.id === model)?.name || model;
  const count = variantCount(body.variants, await maxImageOutputs(model));
  const batchId = sanitizeBatchId(body.batchId) ?? (count > 1 ? newBatchId() : undefined);
  const aspectRatio = (body.aspectRatio || spec.composition.aspectRatio || "2:3").trim();
  const incoming = dataUrls(body.references);
  if (!incoming.length) throw new PosterError("at least one grounding image is required");

  const maxRefs = await maxImageReferences(model);
  const references = incoming.slice(0, maxRefs);
  const persist = dataUrls(body.persistReferences);
  const stored = persist.length ? persist : references;

  const decoded = stored.map(decodeDataUrl);
  const prompt = resolveImagePrompt(spec, body.prompt);
  const startedAt = Date.now();
  const result = await createImage({
    prompt,
    aspectRatio,
    references,
    model,
    n: count,
    label: body.label ?? "generate",
  });
  const durationMs = Date.now() - startedAt;
  const share = result.images.length;
  const images = result.images.map((image) => ({
    ...image,
    cost: result.cost == null || !share ? null : result.cost / share,
    durationMs,
  }));
  if (!images.length) throw new PosterError("OpenRouter did not return image bytes", 502);

  fs.mkdirSync(POSTERS_DIR, { recursive: true });
  return images.map((image, index) => {
    const posterId = newPosterId();
    fs.writeFileSync(posterPath(posterId, "png"), Buffer.from(image.b64, "base64"));
    decoded.forEach((ref, refIndex) => {
      fs.writeFileSync(posterPath(posterId, `ref-${refIndex + 1}.png`), ref.bytes);
    });
    const record: PosterRecord = {
      posterId,
      activityId,
      title: spec.text.title,
      subtitle: spec.text.subtitle,
      spec,
      prompt,
      model,
      modelName,
      batchId,
      aspectRatio,
      cost: image.cost,
      promptCost: finiteCost(body.promptCost),
      durationMs: image.durationMs,
      createdAt: new Date().toISOString(),
      previousPosterId: body.previousPosterId,
      refineNotes: body.refineNotes?.trim() || undefined,
      featureIds: body.featureIds ?? [],
      labels: body.labels ?? [],
      stats: body.stats ?? spec.text.stats,
      styleId: body.styleId ?? "",
      stylePrompt: body.stylePrompt ?? spec.style.medium,
      paletteId: body.paletteId?.trim() || undefined,
      referenceCount: decoded.length,
      variant: index + 1,
      url: `/api/posters/${posterId}/image.png`,
      editor: sanitizePosterEditor(body.editor),
    };
    fs.writeFileSync(posterPath(posterId, "json"), JSON.stringify(record, null, 2));
    return record;
  });
}

export async function modifyPoster(body: ModifyPosterBody): Promise<PosterRecord[]> {
  const request = body.request?.trim() ?? "";
  if (!request) throw new PosterError("a modification request is required");
  const source = readPosterRecord(body.posterId);
  if (!source) throw new PosterError("poster not found", 404);
  const previousUrl = pngDataUrl(readPosterPng(source.posterId));
  const grounding = readPosterGroundingUrls(source.posterId, source.referenceCount);
  if (!grounding.length) throw new PosterError("previous poster is missing grounding images");

  const revised = await revisePosterPrompt({
    imageUrl: previousUrl,
    previousPrompt: source.prompt,
    request,
  });
  const model = resolveImageModel(body.model ?? source.model);
  const spec: PosterSpec = { ...source.spec, finalPrompt: revised.prompt };
  return generatePoster({
    activityId: source.activityId,
    spec,
    prompt: revised.prompt,
    references: modifyImageReferences(previousUrl, grounding, await maxImageReferences(model)),
    persistReferences: grounding,
    previousPosterId: source.posterId,
    refineNotes: request,
    featureIds: source.featureIds,
    labels: source.labels,
    stats: source.stats,
    styleId: source.styleId,
    stylePrompt: source.stylePrompt,
    paletteId: source.paletteId,
    aspectRatio: source.aspectRatio,
    model,
    variants: body.variants,
    promptCost: revised.cost,
    editor: source.editor,
    label: "modify",
  });
}

function newBatchId() {
  return randomBytes(8).toString("hex");
}

export function listPosters(activityId?: number): PosterRecord[] {
  if (!fs.existsSync(POSTERS_DIR)) return [];
  const rows: PosterRecord[] = [];
  for (const name of fs.readdirSync(POSTERS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const record = readPosterRecord(id);
    if (!record) continue;
    if (activityId != null && record.activityId !== activityId) continue;
    rows.push(record);
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}

export function readPosterRecord(posterId: string): PosterRecord | null {
  if (!isSafePosterId(posterId)) return null;
  const file = posterPath(posterId, "json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PosterRecord;
    return {
      ...parsed,
      url: parsed.url || `/api/posters/${posterId}/image.png`,
    };
  } catch {
    return null;
  }
}

export function readPosterPng(posterId: string): Buffer {
  if (!isSafePosterId(posterId)) throw new PosterError("poster not found", 404);
  const file = posterPath(posterId, "png");
  if (!fs.existsSync(file)) throw new PosterError("poster not found", 404);
  return fs.readFileSync(file);
}

export function readPosterRef(posterId: string, index: number): Buffer {
  if (!isSafePosterId(posterId) || index < 1) throw new PosterError("reference not found", 404);
  const file = posterPath(posterId, `ref-${index}.png`);
  if (!fs.existsSync(file)) throw new PosterError("reference not found", 404);
  return fs.readFileSync(file);
}

function finiteCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function stringMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") next[key] = item;
  }
  return next;
}

function stringListMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
    const items = stringList(list);
    if (items.length) next[key] = items;
  }
  return next;
}

function objectList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function finiteInt(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function specMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const next: Record<string, PosterSpec> = {};
  for (const [id, spec] of Object.entries(value as Record<string, unknown>)) {
    if (!id.trim() || !spec || typeof spec !== "object" || Array.isArray(spec)) continue;
    const parsed = validatePosterSpec(spec);
    if (parsed.style.name || parsed.finalPrompt) next[id] = parsed;
  }
  return Object.keys(next).length ? next : undefined;
}

function costMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const next: Record<string, number | null> = {};
  for (const [id, cost] of Object.entries(value as Record<string, unknown>)) {
    if (!id.trim()) continue;
    if (cost == null) next[id] = null;
    else if (typeof cost === "number" && Number.isFinite(cost)) next[id] = cost;
  }
  return Object.keys(next).length ? next : undefined;
}

export function sanitizePosterEditor(value: unknown): PosterEditorSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    featureIds: stringList(raw.featureIds),
    labels: stringList(raw.labels),
    trailNames: stringList(raw.trailNames),
    trailAliases: stringMap(raw.trailAliases),
    areaNames: stringList(raw.areaNames),
    customPois: objectList(raw.customPois),
    customWays: objectList(raw.customWays),
    cropStart: finiteInt(raw.cropStart, 0),
    cropEnd: finiteInt(raw.cropEnd, 1),
    showRouteMarkers: raw.showRouteMarkers !== false,
    routeOnly: raw.routeOnly === true,
    title: typeof raw.title === "string" ? raw.title : "",
    startPlace: typeof raw.startPlace === "string" ? raw.startPlace : "",
    finishPlace: typeof raw.finishPlace === "string" ? raw.finishPlace : "",
    placesEdited: raw.placesEdited === true,
    statIds: stringList(raw.statIds),
    aspectRatio: typeof raw.aspectRatio === "string" && raw.aspectRatio.trim() ? raw.aspectRatio.trim() : "2:3",
    styleIds: stringList(raw.styleIds),
    stylePrompt: typeof raw.stylePrompt === "string" ? raw.stylePrompt : "",
    paletteId: typeof raw.paletteId === "string" && raw.paletteId.trim() ? raw.paletteId.trim() : "auto",
    paletteIdsByStyle: stringListMap(raw.paletteIdsByStyle),
    imageModelIds: stringList(raw.imageModelIds),
    variants: clampVariants(typeof raw.variants === "number" ? raw.variants : undefined),
    specs: specMap(raw.specs),
    planCosts: costMap(raw.planCosts),
  };
}

function sanitizeBatchId(value?: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function setPosterFavorite(posterId: string, favorited: boolean): PosterRecord {
  const record = readPosterRecord(posterId);
  if (!record) throw new PosterError("poster not found", 404);
  const next: PosterRecord = { ...record, favorited };
  fs.writeFileSync(posterPath(posterId, "json"), JSON.stringify(next, null, 2));
  return next;
}

export function deletePoster(posterId: string) {
  if (!isSafePosterId(posterId)) throw new PosterError("poster not found", 404);
  const record = readPosterRecord(posterId);
  if (!record) throw new PosterError("poster not found", 404);
  for (const name of fs.readdirSync(POSTERS_DIR)) {
    if (name.startsWith(`${posterId}.`)) {
      fs.unlinkSync(`${POSTERS_DIR}/${name}`);
    }
  }
}
