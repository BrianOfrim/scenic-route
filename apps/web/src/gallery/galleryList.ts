import type { PosterRecord } from "../api";

export function posterCardSrc(poster: Pick<PosterRecord, "url" | "thumbUrl">) {
  return poster.thumbUrl || poster.url;
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
