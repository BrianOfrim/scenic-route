import assert from "node:assert/strict";
import { test } from "node:test";
import type { PosterRecord } from "../api";
import { galleryPosters, isPendingPoster, mergePosterList, posterCardSrc, refreshPosterList, unionPosters } from "./galleryList";
import { galleryRuns, gallerySections, sortGalleryRuns } from "./galleryRuns";
import { unzipSync } from "fflate";
import { deleteGalleryImages, galleryArchive, selectedGalleryImages } from "./gallerySelection";

function item(overrides: Partial<PosterRecord> = {}): PosterRecord {
  return {
    posterId: "p1",
    activityId: 1,
    title: "Ride",
    subtitle: "",
    model: "google/gemini-test",
    aspectRatio: "2:3",
    cost: null,
    createdAt: "2026-09-24T00:00:00Z",
    styleId: "swiss",
    referenceCount: 1,
    url: "/api/posters/p1/image.png",
    thumbUrl: "/api/posters/p1/thumb.webp",
    ...overrides,
  };
}

test("bulk selection only targets displayed images, never hidden versions or filtered images", () => {
  const visible = [item({ posterId: "latest" }), item({ posterId: "other" })];
  const ids = new Set(["latest", "hidden-version", "filtered-out"]);
  assert.deepEqual(selectedGalleryImages(visible, ids).map(image => image.posterId), ["latest"]);
});

test("gallery ZIP downloads preserve distinct images with safe names", async () => {
  const images = [item({ posterId: "one", title: "../../Same route" }), item({ posterId: "two", title: "../../Same route" })];
  const loaded: string[] = [];
  const archive = await galleryArchive(images, async id => {
    loaded.push(id);
    return new Uint8Array([id === "one" ? 1 : 2, 3, 4]);
  });
  const files = unzipSync(archive);
  assert.deepEqual(loaded, ["one", "two"]);
  assert.equal(Object.keys(files).length, 2, "matching titles must not overwrite images");
  for (const name of Object.keys(files)) {
    assert.ok(!name.includes("/") && !name.includes(".."));
    assert.ok(name.endsWith(".png"));
  }
  assert.deepEqual([...Object.values(files)[0]], [1, 3, 4]);
  assert.deepEqual([...Object.values(files)[1]], [2, 3, 4]);
});

test("bulk deletion reports successes and retains each failed image for retry", async () => {
  const attempted: string[] = [];
  const result = await deleteGalleryImages([item({ posterId: "one" }), item({ posterId: "two" }), item({ posterId: "three" })], async id => {
    attempted.push(id);
    if (id === "two") throw new Error("Network unavailable");
  });
  assert.deepEqual(attempted, ["one", "two", "three"]);
  assert.deepEqual(result.deleted, ["one", "three"]);
  assert.deepEqual(result.failed, [{ id: "two", message: "Ride: Network unavailable" }]);
});

test("posterCardSrc prefers the WebP thumb", () => {
  assert.equal(posterCardSrc(item()), "/api/posters/p1/thumb.webp");
  assert.equal(posterCardSrc(item({ thumbUrl: undefined })), "/api/posters/p1/image.png");
});

test("posterCardSrc uses the inline generate thumb ahead of a network thumb", () => {
  assert.equal(
    posterCardSrc(item({ thumbDataUrl: "data:image/webp;base64,abc" })),
    "data:image/webp;base64,abc",
  );
});

test("unionPosters keeps finished images that the list request has not returned yet", () => {
  const existing = item({ posterId: "old" });
  const finished = item({ posterId: "new", title: "Just finished" });
  const merged = unionPosters([existing], [finished, existing]);
  assert.deepEqual(merged.map((poster) => poster.posterId), ["new", "old"]);
  assert.equal(unionPosters(merged, [finished]), merged);
});

test("refreshPosterList ignores a list snapshot from before a later image finished", () => {
  const finished = item({ posterId: "new", title: "Just finished" });
  const stale = [item({ posterId: "old" })];
  assert.deepEqual(refreshPosterList([finished], stale, 1, 2).map((poster) => poster.posterId), ["new"]);
  assert.deepEqual(refreshPosterList([finished], stale, 2, 2).map((poster) => poster.posterId), ["old"]);
});

test("mergePosterList keeps a hydrated record across a slim refresh", () => {
  const fat = item({
    spec: { style: { name: "Swiss minimal" } } as PosterRecord["spec"],
    prompt: "long prompt",
    editor: { title: "Ride" } as PosterRecord["editor"],
    favorited: false,
  });
  const slim = item({ favorited: true, title: "Ride" });
  const merged = mergePosterList([fat], [slim]);
  assert.equal(merged[0].favorited, true);
  assert.equal(merged[0].prompt, "long prompt");
  assert.equal(merged[0].spec?.style.name, "Swiss minimal");
  assert.equal(merged[0].editor?.title, "Ride");
});

test("mergePosterList keeps an inline thumb across a list refresh", () => {
  const arrived = item({ thumbDataUrl: "data:image/webp;base64,abc" });
  const listed = item();
  assert.equal(mergePosterList([arrived], [listed])[0].thumbDataUrl, "data:image/webp;base64,abc");
  assert.equal(mergePosterList([arrived], [listed])[0].url, listed.url);
});

test("batch deletions bound concurrency and report each result before the batch finishes", async () => {
  const images = Array.from({ length: 6 }, (_, index) => item({ posterId: `p${index}` }));
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  const events: Array<{ id: string; succeeded: boolean; completed: number; total: number }> = [];
  let running = 0;
  let maxRunning = 0;
  const batch = deleteGalleryImages(images, id => new Promise<void>((resolve, reject) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    pending.set(id, {
      resolve: () => { running--; pending.delete(id); resolve(); },
      reject: error => { running--; pending.delete(id); reject(error); },
    });
  }), result => events.push(result));

  assert.equal(pending.size, 4);
  pending.get("p2")!.resolve();
  await Promise.resolve();
  assert.deepEqual(events, [{ id: "p2", succeeded: true, completed: 1, total: 6 }]);
  assert.ok(pending.has("p4"), "a completion starts another deletion without waiting for the other workers");
  assert.equal(pending.size, 4);

  pending.get("p0")!.reject(new Error("offline"));
  await Promise.resolve();
  assert.deepEqual(events[1], { id: "p0", succeeded: false, completed: 2, total: 6 });
  assert.ok(pending.has("p5"), "one failure must not stop the remaining deletions");
  for (const request of [...pending.values()]) request.resolve();
  const result = await batch;
  assert.equal(maxRunning, 4);
  assert.equal(events.length, 6);
  assert.deepEqual(events.map(event => event.completed), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.deleted, ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(result.failed, [{ id: "p0", message: "Ride: offline" }]);
});

test("empty batch deletion makes no requests or progress callbacks", async () => {
  const result = await deleteGalleryImages([], async () => { assert.fail("unexpected deletion"); }, () => { assert.fail("unexpected progress"); });
  assert.deepEqual(result, { deleted: [], failed: [] });
});


test("pending images move their activity to the top and share its row through partial completion", () => {
  const saved = [item({ posterId: "existing", activityId: 1 }), item({ posterId: "other", activityId: 2, createdAt: "2026-09-25T00:00:00Z" })];
  const pending = [0, 1].map(index => ({ id: `job:${index}`, activityId: 1, title: "Ride", model: "model", styleId: "swiss", phase: "queued" as const, createdAt: "2026-09-26T00:00:00Z" }));
  const sections = gallerySections(galleryRuns(galleryPosters(saved, pending)));
  assert.equal(sections.length, 2);
  assert.equal(sections[0].kind, "run");
  if (sections[0].kind !== "run") throw new Error("expected activity row");
  assert.deepEqual(sections[0].run.posters.map(p => p.posterId), ["job:0", "job:1", "existing"]);
  const completed = item({ posterId: "completed", createdAt: "2026-09-26T00:01:00Z" });
  const runs = galleryRuns(galleryPosters([...saved, completed], pending.slice(1)));
  assert.deepEqual(runs.map(run => run.activityId), [1, 2]);
  const row = gallerySections(runs)[0];
  if (row.kind !== "run") throw new Error("expected activity row");
  assert.deepEqual(row.run.posters.map(p => p.posterId), ["completed", "job:1", "existing"]);
  assert.equal(row.run.posters.filter(isPendingPoster).length, 1);
  assert.deepEqual(sortGalleryRuns(runs, "activity", new Map([[1, "2026-09-01"], [2, "2026-09-02"]])).map(run => run.activityId), [2, 1]);
});

test("a new activity gets a row immediately, while unassociated pending images use the grid", () => {
  const pending = { id: "new-job", activityId: 3, title: "New ride", model: "model", phase: "generating" as const, createdAt: "2026-09-26T00:00:00Z" };
  const sections = gallerySections(galleryRuns(galleryPosters([], [pending])));
  assert.equal(sections[0].kind, "run");
  if (sections[0].kind === "run") assert.equal(sections[0].run.activityId, 3);
  const solo = gallerySections(galleryRuns(galleryPosters([], [{ ...pending, activityId: undefined }])));
  assert.equal(solo[0].kind, "singles");
});
