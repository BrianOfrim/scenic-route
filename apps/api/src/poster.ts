import { randomBytes } from "node:crypto";
import fs from "node:fs";
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
  durationMs?: number;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  featureIds: string[];
  labels: string[];
  stats: Array<{ label: string; value: string }>;
  styleId: string;
  stylePrompt: string;
  referenceCount: number;
  variant?: number;
  url: string;
};

export const VARIANTS_PER_PROMPT = 4;

export function variantCount(maxImages: number) {
  const allowed = Number.isFinite(maxImages) ? Math.max(1, Math.round(maxImages)) : 1;
  return Math.min(VARIANTS_PER_PROMPT, allowed);
}

export type GeneratePosterBody = {
  activityId: number;
  spec: unknown;
  references: string[];
  previousPosterId?: string;
  refineNotes?: string;
  featureIds?: string[];
  labels?: string[];
  stats?: Array<{ label: string; value: string }>;
  styleId?: string;
  stylePrompt?: string;
  aspectRatio?: string;
  model?: string;
  batchId?: string;
};

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
  const count = variantCount(await maxImageOutputs(model));
  const batchId = sanitizeBatchId(body.batchId) ?? (count > 1 ? newBatchId() : undefined);
  const aspectRatio = (body.aspectRatio || spec.composition.aspectRatio || "2:3").trim();
  const incoming = (body.references ?? []).filter((item) => typeof item === "string" && item.trim());
  if (!incoming.length) throw new PosterError("at least one grounding image is required");

  const maxRefs = await maxImageReferences(model);
  const references = incoming.slice(0, maxRefs);

  const decoded = references.map(decodeDataUrl);
  const prompt = specToImagePrompt(spec);
  const startedAt = Date.now();
  const result = await createImage({ prompt, aspectRatio, references, model, n: count, label: "generate" });
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
      durationMs: image.durationMs,
      createdAt: new Date().toISOString(),
      previousPosterId: body.previousPosterId,
      refineNotes: body.refineNotes?.trim() || undefined,
      featureIds: body.featureIds ?? [],
      labels: body.labels ?? [],
      stats: body.stats ?? spec.text.stats,
      styleId: body.styleId ?? "",
      stylePrompt: body.stylePrompt ?? spec.style.medium,
      referenceCount: decoded.length,
      variant: index + 1,
      url: `/api/posters/${posterId}/image.png`,
    };
    fs.writeFileSync(posterPath(posterId, "json"), JSON.stringify(record, null, 2));
    return record;
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

function sanitizeBatchId(value?: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
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
