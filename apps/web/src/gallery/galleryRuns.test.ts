import assert from "node:assert/strict";
import { test } from "node:test";
import {
  galleryRuns,
  gallerySections,
  latestInLineage,
  lineageFamily,
  lineageRoot,
  runHeadline,
  sortGalleryRuns,
  viewerSiblings,
} from "./galleryRuns";

function item(
  posterId: string,
  overrides: {
    activityId?: number;
    batchId?: string;
    createdAt?: string;
    title?: string;
    previousPosterId?: string;
    refineNotes?: string;
  } = {},
) {
  return {
    posterId,
    title: overrides.title ?? "Bow Valley",
    createdAt: overrides.createdAt ?? "2026-09-08T12:00:00Z",
    styleId: "middle-earth",
    model: "google/gemini-test",
    ...overrides,
  };
}

test("galleryRuns groups shared activityIds and leaves solo posters alone", () => {
  const runs = galleryRuns([
    item("c", { activityId: 3, createdAt: "2026-09-09T10:00:00Z" }),
    item("b2", { activityId: 2, batchId: "run-b-late", createdAt: "2026-09-08T12:01:00Z" }),
    item("a", { activityId: 1, createdAt: "2026-09-07T09:00:00Z" }),
    item("b1", { activityId: 2, batchId: "run-b-early", createdAt: "2026-09-08T12:00:00Z" }),
  ]);

  assert.deepEqual(
    runs.map((run) => ({
      key: run.key,
      activityId: run.activityId,
      ids: run.posters.map((poster) => poster.posterId),
    })),
    [
      { key: "activity:3", activityId: 3, ids: ["c"] },
      { key: "activity:2", activityId: 2, ids: ["b1", "b2"] },
      { key: "activity:1", activityId: 1, ids: ["a"] },
    ],
  );
});

test("galleryRuns does not group posters that only share a batchId", () => {
  const runs = galleryRuns([
    item("a", { activityId: 1, batchId: "mixed", createdAt: "2026-09-08T12:00:00Z" }),
    item("b", { activityId: 2, batchId: "mixed", createdAt: "2026-09-08T12:01:00Z" }),
  ]);

  assert.deepEqual(
    runs.map((run) => run.posters.map((poster) => poster.posterId)),
    [["b"], ["a"]],
  );
});

test("galleryRuns sorts activity groups by latest poster createdAt, newest first", () => {
  const runs = galleryRuns([
    item("old-a", { activityId: 1, createdAt: "2026-09-01T10:00:00Z" }),
    item("new-a", { activityId: 1, createdAt: "2026-09-10T10:00:00Z" }),
    item("mid-b", { activityId: 2, createdAt: "2026-09-08T10:00:00Z" }),
  ]);

  assert.deepEqual(
    runs.map((run) => run.activityId),
    [1, 2],
  );
  assert.equal(runs[0]?.posters.at(-1)?.createdAt, "2026-09-10T10:00:00Z");
});

test("gallerySections keeps each activity in its own row, newest image first", () => {
  const sections = gallerySections(
    galleryRuns([
      item("d", { activityId: 4, createdAt: "2026-09-10T10:00:00Z" }),
      item("c2", { activityId: 3, batchId: "run-c-late", createdAt: "2026-09-09T12:01:00Z" }),
      item("c1", { activityId: 3, batchId: "run-c-early", createdAt: "2026-09-09T12:00:00Z" }),
      item("b", { activityId: 2, createdAt: "2026-09-08T10:00:00Z" }),
      item("a", { activityId: 1, createdAt: "2026-09-07T10:00:00Z" }),
    ]),
  );

  assert.deepEqual(
    sections.map((section) => section.kind === "run" && section.run.posters.map((poster) => poster.posterId)),
    [["d"], ["c2", "c1"], ["b"], ["a"]],
  );
});

test("runHeadline shares title, mixed labels, count, and total cost", () => {
  const headline = runHeadline([
    {
      title: "Bow Valley",
      createdAt: "2026-09-08T12:00:00Z",
      styleId: "middle-earth",
      model: "google/gemini-test",
      modelName: "Gemini test",
      promptCost: 0.01,
      cost: 0.04,
    },
    {
      title: "Bow Valley",
      createdAt: "2026-09-08T12:01:00Z",
      styleId: "vintage-topo",
      model: "black-forest-labs/flux-test",
      cost: 0.05,
    },
  ]);

  assert.equal(headline.title, "Bow Valley");
  assert.match(headline.detail, /Middle-earth \/ Vintage topo/);
  assert.match(headline.detail, /Gemini test \/ flux-test/);
  assert.match(headline.detail, /2 posters/);
  assert.match(headline.detail, /\$0\.100/);
});

test("favourites-only view keeps single-image activity groups", () => {
  const posters = [
    item("d", { activityId: 4, createdAt: "2026-09-10T10:00:00Z" }),
    item("c2", { activityId: 3, batchId: "run-c-late", createdAt: "2026-09-09T12:01:00Z" }),
    item("c1", { activityId: 3, batchId: "run-c-early", createdAt: "2026-09-09T12:00:00Z" }),
    item("b", { activityId: 2, createdAt: "2026-09-08T10:00:00Z" }),
  ];
  const favorited = new Set(["c1", "b"]);
  const sections = gallerySections(galleryRuns(posters.filter((poster) => favorited.has(poster.posterId))));

  assert.deepEqual(
    sections.map((section) => section.kind === "run" && section.run.posters.map((poster) => poster.posterId)),
    [["c1"], ["b"]],
  );
});

test("lineageFamily walks refinements back to the original", () => {
  const posters = [
    item("orig", { createdAt: "2026-09-08T12:00:00Z" }),
    item("r2", {
      createdAt: "2026-09-09T13:00:00Z",
      previousPosterId: "r1",
      refineNotes: "bolder type",
    }),
    item("r1", {
      createdAt: "2026-09-09T12:00:00Z",
      previousPosterId: "orig",
      refineNotes: "warmer sky",
    }),
  ];
  assert.equal(lineageRoot(posters, "r2")?.posterId, "orig");
  assert.deepEqual(
    lineageFamily(posters, "r2").map((poster) => poster.posterId),
    ["orig", "r1", "r2"],
  );
  assert.deepEqual(
    lineageFamily(posters, "orig").map((poster) => poster.posterId),
    ["orig", "r1", "r2"],
  );
});

test("viewerSiblings keeps activity order regardless of which poster is active", () => {
  const posters = [
    item("b", { activityId: 7, batchId: "late", createdAt: "2026-09-08T12:01:00Z" }),
    item("a", { activityId: 7, batchId: "early", createdAt: "2026-09-08T12:00:00Z" }),
    item("c", { activityId: 7, batchId: "later", createdAt: "2026-09-08T12:02:00Z" }),
  ];
  const order = ["a", "b", "c"];
  assert.deepEqual(
    viewerSiblings(posters[0], posters).map((poster) => poster.posterId),
    order,
  );
  assert.deepEqual(
    viewerSiblings(posters[2], posters).map((poster) => poster.posterId),
    order,
  );
});

test("galleryRuns puts refinements in the same row as the original", () => {
  const runs = galleryRuns([
    item("later", { createdAt: "2026-09-10T10:00:00Z" }),
    item("r1", {
      createdAt: "2026-09-09T12:00:00Z",
      previousPosterId: "orig",
      refineNotes: "warmer sky",
    }),
    item("orig", { createdAt: "2026-09-08T12:00:00Z" }),
  ]);
  assert.deepEqual(
    runs.map((run) => run.posters.map((poster) => poster.posterId)),
    [["later"], ["orig", "r1"]],
  );
});

test("galleryRuns keeps generate variants and refinements of one activity together", () => {
  const runs = galleryRuns([
    item("a1", { activityId: 11, batchId: "gen", createdAt: "2026-09-08T12:00:00Z" }),
    item("a2", { activityId: 11, batchId: "gen", createdAt: "2026-09-08T12:01:00Z" }),
    item("r1", {
      activityId: 11,
      batchId: "ref",
      createdAt: "2026-09-09T12:00:00Z",
      previousPosterId: "a1",
      refineNotes: "warmer sky",
    }),
    item("r2", {
      activityId: 11,
      batchId: "ref",
      createdAt: "2026-09-09T12:01:00Z",
      previousPosterId: "a1",
      refineNotes: "warmer sky",
    }),
  ]);
  assert.equal(runs.length, 1);
  assert.deepEqual(
    runs[0].posters.map((poster) => poster.posterId),
    ["a1", "a2", "r1", "r2"],
  );
});

test("latestInLineage keeps the newest version in the original's slot", () => {
  assert.deepEqual(
    latestInLineage([
      item("a1", { batchId: "gen", createdAt: "2026-09-08T12:00:00Z" }),
      item("a2", { batchId: "gen", createdAt: "2026-09-08T12:01:00Z" }),
      item("r1", {
        batchId: "ref",
        createdAt: "2026-09-09T12:00:00Z",
        previousPosterId: "a1",
        refineNotes: "warmer sky",
      }),
      item("r2", {
        batchId: "ref",
        createdAt: "2026-09-09T12:01:00Z",
        previousPosterId: "r1",
        refineNotes: "bolder type",
      }),
    ]).map((poster) => poster.posterId),
    ["r2", "a2"],
  );
});

test("gallerySections shows only the latest version from each lineage", () => {
  const sections = gallerySections(
    galleryRuns([
      item("later", { activityId: 20, createdAt: "2026-09-10T10:00:00Z" }),
      item("a1", { activityId: 12, batchId: "gen", createdAt: "2026-09-08T12:00:00Z" }),
      item("a2", { activityId: 12, batchId: "gen", createdAt: "2026-09-08T12:01:00Z" }),
      item("r1", {
        activityId: 12,
        batchId: "ref",
        createdAt: "2026-09-09T12:00:00Z",
        previousPosterId: "a1",
        refineNotes: "warmer sky",
      }),
      item("r2", {
        activityId: 12,
        batchId: "ref",
        createdAt: "2026-09-09T12:01:00Z",
        previousPosterId: "r1",
        refineNotes: "bolder type",
      }),
    ]),
  );

  assert.equal(sections[0]?.kind, "run");
  if (sections[0]?.kind !== "run") throw new Error("expected activity row");
  assert.deepEqual(
    sections[0].run.posters.map((poster) => poster.posterId),
    ["later"],
  );

  assert.equal(sections[1]?.kind, "run");
  if (sections[1]?.kind !== "run") throw new Error("expected generate run");
  assert.deepEqual(
    sections[1].run.posters.map((poster) => poster.posterId),
    ["r2", "a2"],
  );
});

test("gallerySections packs a refined singleton into the grid", () => {
  const sections = gallerySections(
    galleryRuns([
      item("r1", {
        createdAt: "2026-09-09T12:00:00Z",
        previousPosterId: "orig",
        refineNotes: "warmer sky",
      }),
      item("orig", { createdAt: "2026-09-08T12:00:00Z" }),
      item("solo", { createdAt: "2026-09-07T10:00:00Z" }),
    ]),
  );

  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.kind, "singles");
  if (sections[0]?.kind !== "singles") throw new Error("expected singles");
  assert.deepEqual(
    sections[0].posters.map((poster) => poster.posterId),
    ["r1", "solo"],
  );
});

test("edit-setup regenerations share an activity without stacking", () => {
  const posters = [
    item("a1", { activityId: 9, batchId: "gen", createdAt: "2026-09-08T12:00:00Z" }),
    item("a2", { activityId: 9, batchId: "gen", createdAt: "2026-09-08T12:01:00Z" }),
    // Historical edit-setup: previousPosterId set, no refineNotes
    item("setup", {
      activityId: 9,
      batchId: "setup-late",
      createdAt: "2026-09-09T12:00:00Z",
      previousPosterId: "a1",
    }),
    // Forward edit-setup: shared activity, new batch
    item("setup2", { activityId: 9, batchId: "setup-later", createdAt: "2026-09-09T12:01:00Z" }),
  ];

  assert.deepEqual(
    lineageFamily(posters, "setup").map((poster) => poster.posterId),
    ["setup"],
  );
  assert.deepEqual(
    lineageFamily(posters, "a1").map((poster) => poster.posterId),
    ["a1"],
  );

  const sections = gallerySections(galleryRuns(posters));
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.kind, "run");
  if (sections[0]?.kind !== "run") throw new Error("expected run");
  assert.deepEqual(
    sections[0].run.posters.map((poster) => poster.posterId),
    ["setup2", "setup", "a2", "a1"],
  );
});

test("runHeadline collapses long theme and model lists", () => {
  const headline = runHeadline(
    ["middle-earth", "vintage-topo", "wpa", "art-deco"].map((styleId, index) => ({
      title: "Bow Valley",
      createdAt: `2026-09-08T12:0${index}:00Z`,
      styleId,
      model: `vendor/model-${index}`,
      cost: 0.04,
    })),
  );
  assert.match(headline.detail, /4 themes/);
  assert.match(headline.detail, /4 models/);
  assert.doesNotMatch(headline.detail, /Middle-earth/);
});


test("gallery sort switches activity groups without changing image order", () => {
  const runs = galleryRuns([
    item("old-activity-new-image", { activityId: 1, createdAt: "2026-09-18T12:00:00Z" }),
    item("new-activity-old-image", { activityId: 2, createdAt: "2026-09-17T12:00:00Z" }),
    item("older-image", { activityId: 1, createdAt: "2026-09-16T12:00:00Z" }),
    item("missing-activity", { activityId: 3, createdAt: "2026-09-19T12:00:00Z" }),
  ]);
  const dates = new Map([[1, "2026-09-01T12:00:00Z"], [2, "2026-09-15T12:00:00Z"]]);
  assert.deepEqual(sortGalleryRuns(runs, "generated", dates).map((run) => run.activityId), [3, 1, 2]);
  const sorted = sortGalleryRuns(runs, "activity", dates);
  assert.deepEqual(sorted.map((run) => run.activityId), [2, 1, 3]);
  const sections = gallerySections(sorted);
  assert.deepEqual(sections[1].kind === "run" && sections[1].run.posters.map((poster) => poster.posterId),
    ["old-activity-new-image", "older-image"]);
  assert.deepEqual(runs.map((run) => run.activityId), [3, 1, 2]);
});

test("activity sort uses generation order for tied or unavailable dates", () => {
  const runs = galleryRuns([
    item("a", { activityId: 1, createdAt: "2026-09-18T12:00:00Z" }),
    item("b", { activityId: 2, createdAt: "2026-09-17T12:00:00Z" }),
  ]);
  for (const dates of [new Map<number, string>(), new Map([[1, "invalid"], [2, "invalid"]]),
    new Map([[1, "2026-09-01T12:00:00Z"], [2, "2026-09-01T12:00:00Z"]])]) {
    assert.deepEqual(sortGalleryRuns(runs, "activity", dates).map((run) => run.activityId), [1, 2]);
  }
});
