import type { PosterRecord } from "../api";

export function posterCardSrc(poster: Pick<PosterRecord, "url" | "thumbUrl">) {
  return poster.thumbUrl || poster.url;
}

/** Add posters that finished generating before the full list refresh includes them. */
export function unionPosters(current: PosterRecord[], incoming: PosterRecord[]): PosterRecord[] {
  const seen = new Set(current.map((item) => item.posterId));
  const fresh = incoming.filter((item) => item.posterId && !seen.has(item.posterId));
  if (!fresh.length) return current;
  return [...fresh, ...current];
}

/**
 * Apply a gallery list response only when no image has finished since the request started.
 * A newer completion has already been inserted locally; replacing with this snapshot would hide it.
 */
export function refreshPosterList(
  current: PosterRecord[],
  incoming: PosterRecord[],
  startedEpoch: number,
  currentEpoch: number,
): PosterRecord[] {
  if (startedEpoch !== currentEpoch) return current;
  return mergePosterList(current, incoming);
}

/** Keep a hydrated Edit Setup / details payload when the slim list refreshes. */
export function mergePosterList(current: PosterRecord[], incoming: PosterRecord[]): PosterRecord[] {
  if (!current.length) return incoming;
  const byId = new Map(current.map((item) => [item.posterId, item]));
  return incoming.map((item) => {
    const prev = byId.get(item.posterId);
    if (!prev?.spec && !prev?.editor && !prev?.prompt) return item;
    return {
      ...item,
      spec: prev.spec,
      prompt: prev.prompt,
      editor: prev.editor,
      featureIds: prev.featureIds,
      labels: prev.labels,
      stats: prev.stats,
      stylePrompt: prev.stylePrompt,
    };
  });
}
