import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchCosts,
  formatBatchCost,
  formatCostBreakdown,
  formatDurationMs,
  formatUsd,
  minMaxReferences,
  posterVariantLabel,
  shortModelLabel,
  sumCosts,
  uniqueIds,
  clampVariants,
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

test("posterVariantLabel numbers siblings of the same model and theme", () => {
  const group = [
    { posterId: "a", model: "one", styleId: "ink", variant: 1 },
    { posterId: "b", model: "one", styleId: "ink", variant: 2 },
    { posterId: "c", model: "two", styleId: "ink", variant: 1 },
  ];
  assert.equal(posterVariantLabel(group[0], group), "1");
  assert.equal(posterVariantLabel(group[2], group), null);
});
