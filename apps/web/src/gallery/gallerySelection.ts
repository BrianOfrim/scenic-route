import { zipSync } from "fflate";
import type { PosterRecord } from "../api";

/** Only displayed, selected images participate; hidden versions are never implicit. */
export function selectedGalleryImages(displayed: PosterRecord[], ids: ReadonlySet<string>) {
  return displayed.filter(image => ids.has(image.posterId));
}

export async function galleryArchive(
  images: PosterRecord[],
  load: (id: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const [index, image] of images.entries()) {
    const name = `${image.title}-${image.styleId}`.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "image";
    files[`${index + 1}-${name}.png`] = await load(image.posterId);
  }
  return zipSync(files, { level: 0 }); // PNGs are already compressed.
}

/** Keep successful deletions when another image fails, and allow the failures to be retried. */
export async function deleteGalleryImages(images: PosterRecord[], remove: (id: string) => Promise<void>) {
  const deleted: string[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  for (const image of images) {
    try {
      await remove(image.posterId);
      deleted.push(image.posterId);
    } catch (error) {
      failed.push({ id: image.posterId, message: `${image.title}: ${error instanceof Error ? error.message : "Could not delete image"}` });
    }
  }
  return { deleted, failed };
}
