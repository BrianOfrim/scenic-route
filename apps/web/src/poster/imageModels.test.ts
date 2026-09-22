import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchCosts,
  formatBatchCost,
  formatCostBreakdown,
  formatDurationMs,
  formatUsd,
  minMaxReferences,
  normalizeImageQualities,
  posterVariantLabel,
  qualitiesForModel,
  resolveConfiguredImageModel,
  shortModelLabel,
  shortQualityLabel,
  sumCosts,
  uiImageModelFromCapabilities,
  uniqueIds,
  clampVariants,
  activeImageModelsFromCapabilities,
  variantCount,
} from "./imageModels";

test("formatDurationMs uses compact units", () => {
  assert.equal(formatDurationMs(4200), "4.2s");
  assert.equal(formatDurationMs(52_000), "52s");
  assert.equal(formatDurationMs(72_000), "1m 12s");
  assert.equal(formatDurationMs(120_000), "2m");
});

test("formatCostBreakdown labels prompt and image gen costs", () => {
  assert.equal(formatUsd(0.042), "$0.042");
  assert.equal(formatCostBreakdown({ cost: 0.16 }), "$0.160");
  assert.equal(formatCostBreakdown({ promptCost: 0.008, cost: 0.043 }), "prompt $0.008 · image $0.043");
  assert.equal(formatCostBreakdown({ promptCost: 0.008, imageCost: 0.043 }), "prompt $0.008 · image $0.043");
  assert.equal(formatCostBreakdown({ promptCost: 0.008 }), "prompt $0.008");
  assert.equal(formatCostBreakdown({}), "");
  assert.equal(sumCosts([0.04, null, 0.02]), 0.06);
  assert.equal(sumCosts([null, undefined]), null);
});

test("formatBatchCost totals a batch and counts each style's prompt once", () => {
  const items = [
    { styleId: "ink", promptCost: 0.008, imageCost: 0.04 },
    { styleId: "ink", promptCost: 0.008, imageCost: 0.04 },
    { styleId: "wpa", promptCost: 0.009, cost: 0.05 },
  ];
  assert.deepEqual(batchCosts(items), { promptCost: 0.017, imageCost: 0.13, total: 0.147 });
  assert.equal(formatBatchCost(items), "total $0.147 · prompt $0.017 · image $0.130");
  assert.equal(formatBatchCost([{ cost: 0.16 }, { cost: 0.04 }]), "total $0.200");
  assert.equal(formatBatchCost([]), "");
});

test("shortModelLabel prefers a distinct display name", () => {
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image", "Gemini 2.5 Flash Image"), "Gemini 2.5 Flash Image");
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image"), "gemini-2.5-flash-image");
  assert.equal(shortModelLabel("local-model", "local-model"), "local-model");
  assert.equal(shortModelLabel(""), "Unknown model");
});

test("normalizeImageQualities defaults to auto and qualitiesForModel respects support", () => {
  assert.deepEqual(normalizeImageQualities([]), ["auto"]);
  assert.deepEqual(normalizeImageQualities(["high", "AUTO", "nope"]), ["high", "auto"]);
  assert.equal(shortQualityLabel("xhigh"), "xhigh");
  assert.deepEqual(qualitiesForModel(undefined, ["medium", "high"]), ["medium", "high"]);
  assert.deepEqual(qualitiesForModel({ qualities: [] }, ["high"]), [null]);
  assert.deepEqual(qualitiesForModel({ qualities: ["auto", "low", "high"] }, ["high", "xhigh"]), ["high"]);
});

test("uniqueIds drops blanks and duplicates", () => {
  assert.deepEqual(uniqueIds([" a ", "a", "", "b"]), ["a", "b"]);
});

test("resolveConfiguredImageModel uses only the server env/secret value", () => {
  assert.equal(resolveConfiguredImageModel(null), null);
  assert.equal(resolveConfiguredImageModel(""), null);
  assert.equal(resolveConfiguredImageModel("not-a-model"), null);
  assert.equal(resolveConfiguredImageModel("openai/gpt-image-2.5-sunburst"), "openai/gpt-image-2.5-sunburst");
  assert.equal(resolveConfiguredImageModel("meta/muse-image"), "meta/muse-image");
});

test("uiImageModelFromCapabilities returns only the configured server model", () => {
  const models = [
    { id: "google/gemini-2.5-flash-image", name: "Nano", maxReferences: 3, maxImages: 1, qualities: [] },
    {
      id: "openai/gpt-image-2.5-sunburst",
      name: "GPT Image 2.5 Sunburst",
      maxReferences: 16,
      maxImages: 10,
      qualities: ["auto", "low", "high"],
    },
    {
      id: "meta/muse-image",
      name: "Muse Image",
      maxReferences: 3,
      maxImages: 1,
      qualities: [],
    },
  ];
  assert.equal(uiImageModelFromCapabilities(models, null), null);
  assert.deepEqual(uiImageModelFromCapabilities(models, "meta/muse-image"), {
    id: "meta/muse-image",
    name: "Muse Image",
    maxReferences: 3,
    maxImages: 1,
    qualities: [],
  });
  assert.deepEqual(uiImageModelFromCapabilities([], "openai/gpt-image-2.5-sunburst"), {
    id: "openai/gpt-image-2.5-sunburst",
    name: "openai/gpt-image-2.5-sunburst",
    maxReferences: 3,
    maxImages: 1,
    qualities: [],
  });
});

test("activeImageModelsFromCapabilities uses Muse Image only", () => {
  const models = [
    { id: "meta/muse-image", name: "Muse Image", maxReferences: 3, maxImages: 1, qualities: [] },
    { id: "openai/gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", maxReferences: 16, maxImages: 10, qualities: ["high"] },
  ];
  assert.deepEqual(activeImageModelsFromCapabilities(models), [models[0]]);
  assert.deepEqual(activeImageModelsFromCapabilities([]).map((model) => model.id), ["meta/muse-image"]);
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

test("clampVariants keeps requests in 1–10 and defaults to 4", () => {
  assert.equal(clampVariants(undefined), 4);
  assert.equal(clampVariants(0), 1);
  assert.equal(clampVariants(99), 10);
});

test("variantCount is the request or the model's max", () => {
  assert.equal(variantCount(4, 10), 4);
  assert.equal(variantCount(8, 10), 8);
  assert.equal(variantCount(4, 1), 1);
  assert.equal(variantCount(4, undefined), 1);
});

test("posterVariantLabel numbers siblings of the same model, theme, and quality", () => {
  const group = [
    { posterId: "a", model: "one", styleId: "ink", quality: "high", variant: 1 },
    { posterId: "b", model: "one", styleId: "ink", quality: "high", variant: 2 },
    { posterId: "c", model: "one", styleId: "ink", quality: "low", variant: 1 },
    { posterId: "d", model: "two", styleId: "ink", quality: "high", variant: 1 },
  ];
  assert.equal(posterVariantLabel(group[0], group), "1");
  assert.equal(posterVariantLabel(group[2], group), null);
  assert.equal(posterVariantLabel(group[3], group), null);
});
