import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createImage, imageModel, maxImageReferences } from "./openrouter";
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
  aspectRatio: string;
  cost: number | null;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
  featureIds: string[];
  labels: string[];
  stats: Array<{ label: string; value: string }>;
  styleId: string;
  stylePrompt: string;
  referenceCount: number;
  url: string;
};

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

export async function generatePoster(body: GeneratePosterBody): Promise<PosterRecord> {
  const activityId = Number(body.activityId);
  if (!Number.isFinite(activityId) || activityId <= 0) {
    throw new PosterError("activityId is required");
  }
  const spec = validatePosterSpec(body.spec);
  const aspectRatio = (body.aspectRatio || spec.composition.aspectRatio || "2:3").trim();
  const incoming = (body.references ?? []).filter((item) => typeof item === "string" && item.trim());
  if (!incoming.length) throw new PosterError("at least one grounding image is required");

  const maxRefs = await maxImageReferences();
  const references = incoming.slice(0, maxRefs);
  if (body.previousPosterId && isSafePosterId(body.previousPosterId) && references.length < maxRefs) {
    const previous = readPosterPng(body.previousPosterId);
    references.push(`data:image/png;base64,${previous.toString("base64")}`);
  }

  const decoded = references.map(decodeDataUrl);
  const prompt = specToImagePrompt(spec);
  const image = await createImage({ prompt, aspectRatio, references, label: "generate" });
  const posterId = newPosterId();
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
  fs.writeFileSync(posterPath(posterId, "png"), Buffer.from(image.b64, "base64"));
  decoded.forEach((ref, index) => {
    fs.writeFileSync(posterPath(posterId, `ref-${index + 1}.png`), ref.bytes);
  });
  const record: PosterRecord = {
    posterId,
    activityId,
    title: spec.text.title,
    subtitle: spec.text.subtitle,
    spec,
    prompt,
    model: imageModel(),
    aspectRatio,
    cost: image.cost,
    createdAt: new Date().toISOString(),
    previousPosterId: body.previousPosterId,
    refineNotes: body.refineNotes?.trim() || undefined,
    featureIds: body.featureIds ?? [],
    labels: body.labels ?? [],
    stats: body.stats ?? spec.text.stats,
    styleId: body.styleId ?? "",
    stylePrompt: body.stylePrompt ?? spec.style.medium,
    referenceCount: decoded.length,
    url: `/api/posters/${posterId}/image.png`,
  };
  fs.writeFileSync(posterPath(posterId, "json"), JSON.stringify(record, null, 2));
  return record;
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
