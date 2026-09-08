import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDurationMs,
  minMaxReferences,
  posterVariantLabel,
  shortModelLabel,
  uniqueIds,
  variantCount,
} from "./imageModels";

test("formatDurationMs uses compact units", () => {
  assert.equal(formatDurationMs(4200), "4.2s");
  assert.equal(formatDurationMs(52_000), "52s");
  assert.equal(formatDurationMs(72_000), "1m 12s");
  assert.equal(formatDurationMs(120_000), "2m");
});

test("shortModelLabel prefers a distinct display name", () => {
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image", "Gemini 2.5 Flash Image"), "Gemini 2.5 Flash Image");
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image"), "gemini-2.5-flash-image");
  assert.equal(shortModelLabel("local-model", "local-model"), "local-model");
  assert.equal(shortModelLabel(""), "Unknown model");
});

test("uniqueIds drops blanks and duplicates", () => {
  assert.deepEqual(uniqueIds([" a ", "a", "", "b"]), ["a", "b"]);
});

test("minMaxReferences uses the most restrictive selected model", () => {
  const models = [
    { id: "one", maxReferences: 8 },
    { id: "two", maxReferences: 3 },
  ];
  assert.equal(minMaxReferences(["one", "two"], models), 3);
  assert.equal(minMaxReferences(["one"], models), 8);
  assert.equal(minMaxReferences([], models), 3);
});

test("variantCount is 4 or the model's max", () => {
  assert.equal(variantCount(10), 4);
  assert.equal(variantCount(1), 1);
  assert.equal(variantCount(undefined), 1);
});

test("posterVariantLabel numbers siblings of the same model and theme", () => {
  const group = [
    { posterId: "a", model: "one", styleId: "ink", variant: 1 },
    { posterId: "b", model: "one", styleId: "ink", variant: 2 },
    { posterId: "c", model: "two", styleId: "ink", variant: 1 },
  ];
  assert.equal(posterVariantLabel(group[0], group), "1");
  assert.equal(posterVariantLabel(group[2], group), null);
});
