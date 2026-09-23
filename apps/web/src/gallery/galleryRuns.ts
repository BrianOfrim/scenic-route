import { shortModelLabel } from "../poster/imageModels";
import { styleLabel } from "../poster/styles";

export type GalleryRunItem = {
  posterId: string;
  activityId?: number;
  batchId?: string;
  createdAt: string;
  previousPosterId?: string;
  refineNotes?: string;
};

export type LineageItem = {
  posterId: string;
  previousPosterId?: string;
  refineNotes?: string;
  createdAt: string;
};

/** True image refine (modify); edit-setup regenerations are not stackable lineage. */
function isImageRefine<T extends LineageItem>(item: T) {
  return Boolean(item.previousPosterId && item.refineNotes?.trim());
}

/** Walk refine previousPosterId links to the oldest saved ancestor. */
export function lineageRoot<T extends LineageItem>(posters: T[], startId: string): T | undefined {
  const byId = new Map(posters.map((item) => [item.posterId, item]));
  const start = byId.get(startId);
  if (!start) return undefined;
  const seen = new Set<string>();
  let current = start;
  while (
    isImageRefine(current) &&
    current.previousPosterId &&
    byId.has(current.previousPosterId) &&
    !seen.has(current.posterId)
  ) {
    seen.add(current.posterId);
    current = byId.get(current.previousPosterId)!;
  }
  return current;
}

/** Keep the newest version of each lineage, in the original's batch order. */
export function latestInLineage<T extends GalleryRunItem>(posters: T[]): T[] {
  const families = new Map<string, T[]>();
  const rootOrder: string[] = [];
  for (const poster of posters) {
    const root = lineageRoot(posters, poster.posterId);
    if (!root) continue;
    let family = families.get(root.posterId);
    if (!family) {
      family = [];
      families.set(root.posterId, family);
      rootOrder.push(root.posterId);
    }
    if (!family.some((item) => item.posterId === poster.posterId)) family.push(poster);
  }
  return rootOrder.map((rootId) => {
    const family = families.get(rootId) ?? [];
    return [...family].sort(byCreatedThenId).at(-1)!;
  });
}

/** Original first, then descendants in generation order. */
export function lineageFamily<T extends LineageItem>(posters: T[], startId: string): T[] {
  const root = lineageRoot(posters, startId);
  if (!root) return [];
  const family: T[] = [];
  const added = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    if (added.has(current.posterId)) continue;
    added.add(current.posterId);
    family.push(current);
    const children = posters
      .filter(
        (item) =>
          isImageRefine(item) &&
          item.previousPosterId === current.posterId &&
          !added.has(item.posterId),
      )
      .sort(byCreatedThenId);
    queue.push(...children);
  }
  return family;
}

/**
 * Posters shown together in the lightbox strip: same activity and/or refine lineage.
 * Order is stable across selection (activity creation order, then lineage-only extras).
 */
export function viewerSiblings<T extends GalleryRunItem & LineageItem>(active: T, posters: T[]): T[] {
  const family = lineageFamily(posters, active.posterId);
  const activity =
    active.activityId != null
      ? posters.filter((item) => item.activityId === active.activityId).sort(byCreatedThenId)
      : [];
  const siblings = uniqueByPosterId([...activity, ...family]);
  if (!siblings.some((item) => item.posterId === active.posterId)) siblings.push(active);
  return siblings;
}

function uniqueByPosterId<T extends { posterId: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.posterId)) return false;
    seen.add(item.posterId);
    return true;
  });
}

function byCreatedThenId<T extends { posterId: string; createdAt: string }>(a: T, b: T) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.posterId.localeCompare(b.posterId);
}

function findRoot(parent: number[], index: number) {
  let current = index;
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]];
    current = parent[current];
  }
  return current;
}

/** Merge generate batches with later refinements of any poster in that batch. */
export function attachLineage<T extends GalleryRunItem>(runs: GalleryRun<T>[]): GalleryRun<T>[] {
  if (runs.length < 2) return runs;
  const parent = runs.map((_, index) => index);
  const unify = (left: number, right: number) => {
    const a = findRoot(parent, left);
    const b = findRoot(parent, right);
    if (a !== b) parent[a] = b;
  };
  const runByPoster = new Map<string, number>();
  runs.forEach((run, index) => {
    for (const poster of run.posters) runByPoster.set(poster.posterId, index);
  });
  runs.forEach((run, index) => {
    for (const poster of run.posters) {
      const previous = poster.previousPosterId;
      if (!previous) continue;
      const other = runByPoster.get(previous);
      if (other != null && other !== index) unify(index, other);
    }
  });
  const grouped = new Map<number, T[]>();
  runs.forEach((run, index) => {
    const root = findRoot(parent, index);
    const list = grouped.get(root) ?? [];
    list.push(...run.posters);
    grouped.set(root, list);
  });
  return [...grouped.entries()]
    .map(([index, items]) => {
      const seen = new Set<string>();
      const posters = items.filter((item) => {
        if (seen.has(item.posterId)) return false;
        seen.add(item.posterId);
        return true;
      });
      posters.sort(byCreatedThenId);
      return {
        key: runs[index]?.key ?? posters[0]?.posterId ?? String(index),
        activityId: posters.find((item) => item.activityId != null)?.activityId,
        batchId: posters[0]?.batchId,
        posters,
      };
    })
    .sort((a, b) => {
      const aLatest = a.posters[a.posters.length - 1]?.createdAt ?? "";
      const bLatest = b.posters[b.posters.length - 1]?.createdAt ?? "";
      const byDate = newestFirst(aLatest, bLatest);
      return byDate || a.key.localeCompare(b.key);
    });
}

export type GalleryRun<T extends GalleryRunItem = GalleryRunItem> = {
  key: string;
  activityId?: number;
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

function activityGroupKey<T extends GalleryRunItem>(poster: T) {
  return poster.activityId != null ? `activity:${poster.activityId}` : poster.posterId;
}

/** Group posters that share an activity, newest group first. Items without an activity stay alone. */
export function galleryRuns<T extends GalleryRunItem>(posters: T[]): GalleryRun<T>[] {
  const groups = new Map<string, T[]>();
  for (const poster of posters) {
    const key = activityGroupKey(poster);
    const group = groups.get(key);
    if (group) group.push(poster);
    else groups.set(key, [poster]);
  }

  const activityRuns = [...groups.entries()]
    .map(([key, items]) => {
      const postersInRun = [...items].sort(byCreatedThenId);
      return {
        key,
        activityId: postersInRun.find((item) => item.activityId != null)?.activityId,
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
  return attachLineage(activityRuns);
}

export type GallerySort = "generated" | "activity";

/** Missing activity dates sort last; ties retain newest-generation order. */
export function sortGalleryRuns<T extends GalleryRunItem>(
  runs: GalleryRun<T>[],
  sort: GallerySort,
  activityDates: ReadonlyMap<number, string>,
): GalleryRun<T>[] {
  if (sort === "generated") return runs;
  const timestamp = (run: GalleryRun<T>) => {
    const date = run.activityId == null ? undefined : activityDates.get(run.activityId);
    const value = date ? Date.parse(date) : NaN;
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...runs].sort((a, b) => {
    const left = timestamp(a);
    const right = timestamp(b);
    return left === right ? 0 : left > right ? -1 : 1;
  });
}

/** Keep activities as rows, including singletons; grid only unassociated single posters. */
export function gallerySections<T extends GalleryRunItem>(runs: GalleryRun<T>[]): GallerySection<T>[] {
  const sections: GallerySection<T>[] = [];
  let singles: T[] = [];

  function flushSingles() {
    if (!singles.length) return;
    sections.push({ kind: "singles", posters: singles });
    singles = [];
  }

  for (const run of runs) {
    const posters = latestInLineage(run.posters).sort(
      (a, b) => newestFirst(a.createdAt, b.createdAt) || a.posterId.localeCompare(b.posterId),
    );
    if (posters.length === 1 && run.activityId == null) {
      singles.push(posters[0]);
      continue;
    }
    flushSingles();
    sections.push({ kind: "run", run: { ...run, posters } });
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
  return {
    title: newest.title,
    date: new Date(newest.createdAt).toLocaleString(),
    detail: [
      summarizeLabels(styles, 3, "theme"),
      summarizeLabels(models, 2, "model"),
      posters.length > 1 ? `${posters.length} images` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function summarizeLabels(labels: string[], max: number, noun: string) {
  if (labels.length <= max) return labels.join(" / ");
  return `${labels.length} ${noun}${labels.length === 1 ? "" : "s"}`;
}
