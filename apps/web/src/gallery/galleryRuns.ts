import { batchCosts, formatUsd, shortModelLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";

export type GalleryRunItem = {
  posterId: string;
  batchId?: string;
  createdAt: string;
};

export type GalleryRun<T extends GalleryRunItem = GalleryRunItem> = {
  key: string;
  batchId?: string;
  posters: T[];
};

export type GallerySection<T extends GalleryRunItem = GalleryRunItem> =
  | { kind: "run"; run: GalleryRun<T> }
  | { kind: "singles"; posters: T[] };

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function newestFirst(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/** Group posters that share a batch, newest run first. Items without a batch stay alone. */
export function galleryRuns<T extends GalleryRunItem>(posters: T[]): GalleryRun<T>[] {
  const groups = new Map<string, T[]>();
  for (const poster of posters) {
    const key = poster.batchId || poster.posterId;
    const group = groups.get(key);
    if (group) group.push(poster);
    else groups.set(key, [poster]);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const postersInRun = [...items].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
        return a.posterId.localeCompare(b.posterId);
      });
      return {
        key,
        batchId: postersInRun[0]?.batchId,
        posters: postersInRun,
      };
    })
    .sort((a, b) => {
      const aLatest = a.posters[a.posters.length - 1]?.createdAt ?? "";
      const bLatest = b.posters[b.posters.length - 1]?.createdAt ?? "";
      const byDate = newestFirst(aLatest, bLatest);
      return byDate || a.key.localeCompare(b.key);
    });
}

/** Keep multi-poster runs as rows; pack neighboring singletons back into a grid. */
export function gallerySections<T extends GalleryRunItem>(runs: GalleryRun<T>[]): GallerySection<T>[] {
  const sections: GallerySection<T>[] = [];
  let singles: T[] = [];

  function flushSingles() {
    if (!singles.length) return;
    sections.push({ kind: "singles", posters: singles });
    singles = [];
  }

  for (const run of runs) {
    if (run.posters.length === 1) {
      singles.push(run.posters[0]);
      continue;
    }
    flushSingles();
    sections.push({ kind: "run", run });
  }
  flushSingles();
  return sections;
}

export function runHeadline(
  posters: Array<{
    title: string;
    createdAt: string;
    styleId: string;
    spec?: { style?: { name?: string } };
    model: string;
    modelName?: string;
    promptCost?: number | null;
    cost?: number | null;
  }>,
) {
  const newest = posters.reduce((best, item) => (item.createdAt >= best.createdAt ? item : best));
  const styles = unique(posters.map((item) => styleLabel(item.styleId, item.spec?.style?.name)));
  const models = unique(posters.map((item) => shortModelLabel(item.model, item.modelName)));
  const total = batchCosts(posters).total;
  return {
    title: newest.title,
    date: new Date(newest.createdAt).toLocaleString(),
    detail: [
      summarizeLabels(styles, 3, "theme"),
      summarizeLabels(models, 2, "model"),
      posters.length > 1 ? `${posters.length} posters` : null,
      total != null ? formatUsd(total) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function summarizeLabels(labels: string[], max: number, noun: string) {
  if (labels.length <= max) return labels.join(" / ");
  return `${labels.length} ${noun}${labels.length === 1 ? "" : "s"}`;
}
