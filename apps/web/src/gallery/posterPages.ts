import type { PosterRecord } from "../api";

export type PosterPage = { posters: PosterRecord[]; nextCursor: string | null };

/** Publish each page before requesting the next so the gallery can paint during the full load. */
export async function loadPosterPages(
  fetchPage: (before?: string) => Promise<PosterPage>,
  onProgress: (posters: PosterRecord[]) => void,
): Promise<PosterRecord[]> {
  const byId = new Map<string, PosterRecord>();
  const cursors = new Set<string>();
  let before: string | undefined;
  for (;;) {
    const page = await fetchPage(before);
    for (const poster of page.posters) byId.set(poster.posterId, poster);
    const posters = [...byId.values()].sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
    onProgress(posters);
    if (!page.nextCursor) return posters;
    if (cursors.has(page.nextCursor)) throw new Error("Could not finish loading images");
    cursors.add(page.nextCursor);
    before = page.nextCursor;
  }
}
