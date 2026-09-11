import assert from "node:assert/strict";
import { test } from "node:test";
import { galleryRuns, gallerySections, runHeadline } from "./galleryRuns";

function item(
  posterId: string,
  overrides: { batchId?: string; createdAt?: string; title?: string } = {},
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

test("galleryRuns groups shared batchIds and leaves solo posters alone", () => {
  const runs = galleryRuns([
    item("c", { createdAt: "2026-09-09T10:00:00Z" }),
    item("b2", { batchId: "run-b", createdAt: "2026-09-08T12:01:00Z" }),
    item("a", { createdAt: "2026-09-07T09:00:00Z" }),
    item("b1", { batchId: "run-b", createdAt: "2026-09-08T12:00:00Z" }),
  ]);

  assert.deepEqual(
    runs.map((run) => ({ key: run.key, ids: run.posters.map((poster) => poster.posterId) })),
    [
      { key: "c", ids: ["c"] },
      { key: "run-b", ids: ["b1", "b2"] },
      { key: "a", ids: ["a"] },
    ],
  );
});

test("gallerySections packs neighboring singletons into a grid", () => {
  const sections = gallerySections(
    galleryRuns([
      item("d", { createdAt: "2026-09-10T10:00:00Z" }),
      item("c2", { batchId: "run-c", createdAt: "2026-09-09T12:01:00Z" }),
      item("c1", { batchId: "run-c", createdAt: "2026-09-09T12:00:00Z" }),
      item("b", { createdAt: "2026-09-08T10:00:00Z" }),
      item("a", { createdAt: "2026-09-07T10:00:00Z" }),
    ]),
  );

  assert.equal(sections[0]?.kind, "singles");
  if (sections[0]?.kind !== "singles") throw new Error("expected leading singles");
  assert.deepEqual(
    sections[0].posters.map((poster) => poster.posterId),
    ["d"],
  );

  assert.equal(sections[1]?.kind, "run");
  if (sections[1]?.kind !== "run") throw new Error("expected run");
  assert.deepEqual(
    sections[1].run.posters.map((poster) => poster.posterId),
    ["c1", "c2"],
  );

  assert.equal(sections[2]?.kind, "singles");
  if (sections[2]?.kind !== "singles") throw new Error("expected trailing singles");
  assert.deepEqual(
    sections[2].posters.map((poster) => poster.posterId),
    ["b", "a"],
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

test("favourites-only view keeps starred posters and regroups leftover singles", () => {
  const posters = [
    item("d", { createdAt: "2026-09-10T10:00:00Z" }),
    item("c2", { batchId: "run-c", createdAt: "2026-09-09T12:01:00Z" }),
    item("c1", { batchId: "run-c", createdAt: "2026-09-09T12:00:00Z" }),
    item("b", { createdAt: "2026-09-08T10:00:00Z" }),
  ];
  const favorited = new Set(["c1", "b"]);
  const sections = gallerySections(galleryRuns(posters.filter((poster) => favorited.has(poster.posterId))));

  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.kind, "singles");
  if (sections[0]?.kind !== "singles") throw new Error("expected singles after favourite filter");
  assert.deepEqual(
    sections[0].posters.map((poster) => poster.posterId),
    ["c1", "b"],
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
