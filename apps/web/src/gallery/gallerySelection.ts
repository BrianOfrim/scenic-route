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
export async function deleteGalleryImages(
  images: PosterRecord[],
  remove: (id: string) => Promise<void>,
  onProgress?: (result: { id: string; succeeded: boolean; completed: number; total: number }) => void,
) {
  const results: Array<{ id: string; message?: string }> = new Array(images.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < images.length) {
      const index = next++;
      const image = images[index];
      try {
        await remove(image.posterId);
        results[index] = { id: image.posterId };
      } catch (error) {
        results[index] = { id: image.posterId, message: `${image.title}: ${error instanceof Error ? error.message : "Could not delete image"}` };
      }
      onProgress?.({ id: image.posterId, succeeded: results[index].message === undefined, completed: ++completed, total: images.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, worker));
  return {
    deleted: results.filter(result => result.message === undefined).map(result => result.id),
    failed: results.flatMap(result => result.message === undefined ? [] : [{ id: result.id, message: result.message }]),
  };
}
