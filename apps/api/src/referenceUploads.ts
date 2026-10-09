import { randomUUID } from "node:crypto";
import { sniffImageMime } from "./imageMime";
import { createR2Store, r2Config, type ObjectStore } from "./storage";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const URL_SECONDS = 24 * 60 * 60;
export class ReferenceUploadError extends Error {
  constructor(message: string, public status: 400 | 404 | 503 = 400) { super(message); }
}

function referenceStore() {
  const config = r2Config();
  if (!config) throw new ReferenceUploadError("R2 must be configured to upload reference images", 503);
  return createR2Store(config, "references/");
}

export async function uploadReferences(userId: string, references: unknown, store = referenceStore()) {
  if (!Array.isArray(references) || !references.length || references.length > 16) {
    throw new ReferenceUploadError("between 1 and 16 reference images are required");
  }
  let total = 0;
  const images = references.map((value) => {
    const match = typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
    if (!match) throw new ReferenceUploadError("references must be PNG, JPEG, or WebP data URLs");
    const bytes = Buffer.from(match[2], "base64");
    const mime = sniffImageMime(bytes);
    total += bytes.length;
    if (!mime || mime !== `image/${match[1]}`) throw new ReferenceUploadError("reference image format does not match its contents");
    if (bytes.length > 20 * 1024 * 1024 || total > 40 * 1024 * 1024) {
      throw new ReferenceUploadError("reference images must be under 20 MB each and 40 MB total");
    }
    return { bytes, mime };
  });
  const referenceBatchId = randomUUID();
  const expiresAt = Date.now() + RETENTION_MS;
  await Promise.all(images.map((image, index) => store.put(userId, `${referenceBatchId}/${index}`, image.bytes, image.mime)));
  await store.put(userId, `${referenceBatchId}/manifest`, Buffer.from(JSON.stringify({ expiresAt, mimes: images.map(image => image.mime) })), "application/json");
  return { referenceBatchId, expiresAt };
}

/** Resolve only server-created, user-scoped batches; never fetch client-supplied URLs. */
export async function resolveReferences(userId: string, batchId: string, includeBytes = false, store = referenceStore()) {
  if (typeof batchId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(batchId)) {
    throw new ReferenceUploadError("invalid reference batch id");
  }
  const bytes = await store.get(userId, `${batchId}/manifest`);
  if (!bytes) throw new ReferenceUploadError("reference batch not found", 404);
  const manifest = JSON.parse(bytes.toString()) as { expiresAt: number; mimes: string[] };
  const remainingSeconds = Math.floor((manifest.expiresAt - Date.now()) / 1000);
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 1) throw new ReferenceUploadError("reference batch expired; upload the images again");
  if (!store.signedUrl) throw new ReferenceUploadError("R2 signed URLs are unavailable", 503);
  return Promise.all(manifest.mimes.map(async (mime, index) => {
    const name = `${batchId}/${index}`;
    const url = await store.signedUrl!(userId, name, Math.min(URL_SECONDS, remainingSeconds));
    const image = includeBytes ? await store.get(userId, name) : null;
    if (includeBytes && !image) throw new ReferenceUploadError("reference image not found", 404);
    return { url, mime, bytes: image };
  }));
}
