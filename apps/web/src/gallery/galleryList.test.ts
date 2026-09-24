import assert from "node:assert/strict";
import { test } from "node:test";
import type { PosterRecord } from "../api";
import { mergePosterList, posterCardSrc } from "./galleryList";

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

test("posterCardSrc prefers the WebP thumb", () => {
  assert.equal(posterCardSrc(item()), "/api/posters/p1/thumb.webp");
  assert.equal(posterCardSrc(item({ thumbUrl: undefined })), "/api/posters/p1/image.png");
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
