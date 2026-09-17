import { randomBytes } from "node:crypto";
import { getActivity } from "./activities";
import { revisePosterPrompt } from "./modifyPrompt";
import { createImage, listImageModels, maxImageOutputs, maxImageReferences, resolveImageModel } from "./openrouter";
import { isSafePosterId } from "./paths";
import { specToImagePrompt, validatePosterSpec, type PosterSpec } from "./posterSpec";
import { posterStore } from "./storage";

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
  userId?: string;
  activityId: number;
  title: string;
  subtitle: string;
  spec: PosterSpec;
  prompt: string;
  model: string;
  modelName?: string;
  batchId?: string;
  aspectRatio: string;
  /** Image quality setting when the model supports it (e.g. auto/low/high). */
  quality?: string;
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
  /** Selected image qualities for comparison runs. */
  qualities?: string[];
  specs?: Record<string, PosterSpec>;
  planCosts?: Record<string, number | null>;
  landmarkNearM?: Record<string, number>;
};

export const DEFAULT_VARIANTS = 4;
export const MAX_VARIANTS = 10;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "auto";

export function clampVariants(value?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VARIANTS;
  return Math.min(MAX_VARIANTS, Math.max(1, Math.round(n)));
}

export function variantCount(requested: number | undefined, maxImages: number) {
  const allowed = Number.isFinite(maxImages) ? Math.max(1, Math.round(maxImages)) : 1;
  return Math.min(clampVariants(requested), allowed);
}

/** Returns a canonical quality slug, or null when unset / unsupported. */
export function normalizeImageQuality(value?: string | null): ImageQuality | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  return (IMAGE_QUALITIES as readonly string[]).includes(trimmed) ? (trimmed as ImageQuality) : null;
}

export function normalizeImageQualities(values?: string[] | null): ImageQuality[] {
  const next = uniqueQualities(
    (values ?? []).map((item) => normalizeImageQuality(item)).filter((item): item is ImageQuality => item != null),
  );
  return next.length ? next : [DEFAULT_IMAGE_QUALITY];
}

function uniqueQualities(values: ImageQuality[]) {
  const seen = new Set<string>();
  const next: ImageQuality[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
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
  quality?: string;
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

export async function readPosterGroundingUrls(
  userId: string,
  posterId: string,
  referenceCount: number,
): Promise<string[]> {
  const urls: string[] = [];
  for (let index = 1; index <= referenceCount; index += 1) {
    try {
      urls.push(pngDataUrl(await readPosterRef(userId, posterId, index)));
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

export async function generatePoster(userId: string, body: GeneratePosterBody): Promise<PosterRecord[]> {
  const activityId = Number(body.activityId);
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new PosterError("activityId is required");
  }
  if (!(await getActivity(userId, activityId))) {
    throw new PosterError("activity not found", 404);
  }
  const spec = validatePosterSpec(body.spec);
  const model = resolveImageModel(body.model);
  const listed = await listImageModels();
  const modelName = listed.find((item) => item.id === model)?.name || model;
  const count = variantCount(body.variants, await maxImageOutputs(model));
  const batchId = sanitizeBatchId(body.batchId) ?? (count > 1 ? newBatchId() : undefined);
  const aspectRatio = (body.aspectRatio || spec.composition.aspectRatio || "2:3").trim();
  const quality = normalizeImageQuality(body.quality) ?? undefined;
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
    quality,
    label: body.label ?? "generate",
    user: userId,
  });
  const durationMs = Date.now() - startedAt;
  const share = result.images.length;
  const images = result.images.map((image) => ({
    ...image,
    cost: result.cost == null || !share ? null : result.cost / share,
    durationMs,
  }));
  if (!images.length) throw new PosterError("OpenRouter did not return image bytes", 502);

  const store = posterStore();
  return Promise.all(
    images.map(async (image, index) => {
      const posterId = newPosterId();
      const record: PosterRecord = {
        posterId,
        userId,
        activityId,
        title: spec.text.title,
        subtitle: spec.text.subtitle,
        spec,
        prompt,
        model,
        modelName,
        batchId,
        aspectRatio,
        quality,
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
      await store.put(userId, `${posterId}.png`, Buffer.from(image.b64, "base64"), "image/png");
      await Promise.all(
        decoded.map((ref, refIndex) =>
          store.put(userId, `${posterId}.ref-${refIndex + 1}.png`, ref.bytes, ref.mime),
        ),
      );
      await store.put(userId, `${posterId}.json`, Buffer.from(JSON.stringify(record, null, 2)), "application/json");
      return record;
    }),
  );
}

export async function modifyPoster(userId: string, body: ModifyPosterBody): Promise<PosterRecord[]> {
  const request = body.request?.trim() ?? "";
  if (!request) throw new PosterError("a modification request is required");
  const source = await readPosterRecord(userId, body.posterId);
  if (!source) throw new PosterError("poster not found", 404);
  const previousUrl = pngDataUrl(await readPosterPng(userId, source.posterId));
  const grounding = await readPosterGroundingUrls(userId, source.posterId, source.referenceCount);
  if (!grounding.length) throw new PosterError("previous poster is missing grounding images");

  const revised = await revisePosterPrompt({
    imageUrl: previousUrl,
    previousPrompt: source.prompt,
    request,
    userId,
  });
  const model = resolveImageModel(body.model ?? source.model);
  const spec: PosterSpec = { ...source.spec, finalPrompt: revised.prompt };
  return generatePoster(userId, {
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
    quality: source.quality,
    variants: body.variants,
    promptCost: revised.cost,
    editor: source.editor,
    label: "modify",
  });
}

function newBatchId() {
  return randomBytes(8).toString("hex");
}

export async function listPosters(userId: string, activityId?: number): Promise<PosterRecord[]> {
  const names = await posterStore().listJsonNames(userId);
  const rows: PosterRecord[] = [];
  for (const name of names) {
    const record = await readPosterRecord(userId, name.slice(0, -".json".length));
    if (!record) continue;
    if (activityId != null && record.activityId !== activityId) continue;
    rows.push(record);
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows;
}

export async function readPosterRecord(userId: string, posterId: string): Promise<PosterRecord | null> {
  if (!isSafePosterId(posterId)) return null;
  const bytes = await posterStore().get(userId, `${posterId}.json`);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as PosterRecord;
    return {
      ...parsed,
      userId,
      url: parsed.url || `/api/posters/${posterId}/image.png`,
    };
  } catch {
    return null;
  }
}

export async function readPosterPng(userId: string, posterId: string): Promise<Buffer> {
  if (!isSafePosterId(posterId)) throw new PosterError("poster not found", 404);
  const bytes = await posterStore().get(userId, `${posterId}.png`);
  if (!bytes) throw new PosterError("poster not found", 404);
  return bytes;
}

export async function readPosterRef(userId: string, posterId: string, index: number): Promise<Buffer> {
  if (!isSafePosterId(posterId) || index < 1) throw new PosterError("reference not found", 404);
  const bytes = await posterStore().get(userId, `${posterId}.ref-${index}.png`);
  if (!bytes) throw new PosterError("reference not found", 404);
  return bytes;
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
    qualities: normalizeImageQualities(stringList(raw.qualities)),
    specs: specMap(raw.specs),
    planCosts: costMap(raw.planCosts),
    landmarkNearM: numberMap(raw.landmarkNearM),
  };
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (key.trim() && Number.isFinite(n) && n >= 0) next[key] = Math.round(n);
  }
  return next;
}

function sanitizeBatchId(value?: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export async function setPosterFavorite(userId: string, posterId: string, favorited: boolean): Promise<PosterRecord> {
  const record = await readPosterRecord(userId, posterId);
  if (!record) throw new PosterError("poster not found", 404);
  const next: PosterRecord = { ...record, userId, favorited };
  await posterStore().put(userId, `${posterId}.json`, Buffer.from(JSON.stringify(next, null, 2)), "application/json");
  return next;
}

export async function deletePoster(userId: string, posterId: string) {
  if (!isSafePosterId(posterId)) throw new PosterError("poster not found", 404);
  const record = await readPosterRecord(userId, posterId);
  if (!record) throw new PosterError("poster not found", 404);
  await posterStore().removeByPosterId(userId, posterId);
}
