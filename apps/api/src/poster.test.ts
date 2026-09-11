import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VARIANTS, MAX_VARIANTS, clampVariants, sanitizePosterEditor, variantCount } from "./poster";

test("clampVariants keeps requests in 1–10 and defaults to 4", () => {
  assert.equal(DEFAULT_VARIANTS, 4);
  assert.equal(MAX_VARIANTS, 10);
  assert.equal(clampVariants(undefined), 4);
  assert.equal(clampVariants(4), 4);
  assert.equal(clampVariants(0), 1);
  assert.equal(clampVariants(99), 10);
});

test("variantCount is the request or the model's max, whichever is smaller", () => {
  assert.equal(variantCount(4, 10), 4);
  assert.equal(variantCount(8, 10), 8);
  assert.equal(variantCount(4, 1), 1);
  assert.equal(variantCount(undefined, 10), 4);
  assert.equal(variantCount(0, 2), 1);
});

test("sanitizePosterEditor keeps crop, labels, and custom annotations", () => {
  const editor = sanitizePosterEditor({
    featureIds: ["lakes", 2, "peaks"],
    labels: ["Castle Mountain"],
    trailNames: ["Bow Valley Parkway"],
    trailAliases: { "Bow Valley Parkway": "Parkway" },
    areaNames: ["Banff"],
    customPois: [{ name: "Mailbox", lat: 51.2, lng: -115.5 }],
    customWays: "nope",
    cropStart: 20.4,
    cropEnd: 80,
    showRouteMarkers: false,
    routeOnly: true,
    title: "Dawn Patrol",
    startPlace: "Banff",
    finishPlace: "Lake Louise",
    placesEdited: true,
    statIds: ["title", "distance"],
    aspectRatio: "16:9",
    styleIds: ["middle-earth"],
    stylePrompt: "ink",
    paletteId: "process-blue",
    imageModelIds: ["google/gemini-test"],
    variants: 2,
  });
  assert.ok(editor);
  assert.deepEqual(editor.featureIds, ["lakes", "peaks"]);
  assert.equal(editor.cropStart, 20);
  assert.equal(editor.cropEnd, 80);
  assert.equal(editor.showRouteMarkers, false);
  assert.equal(editor.routeOnly, true);
  assert.equal(editor.customPois.length, 1);
  assert.deepEqual(editor.customWays, []);
  assert.equal(editor.trailAliases["Bow Valley Parkway"], "Parkway");
  assert.equal(editor.variants, 2);
  assert.equal(editor.paletteId, "process-blue");
  assert.deepEqual(editor.paletteIdsByStyle, {});
});

test("sanitizePosterEditor defaults paletteId to auto", () => {
  const editor = sanitizePosterEditor({
    styleIds: ["swiss"],
    stylePrompt: "",
  });
  assert.equal(editor?.paletteId, "auto");
  assert.equal(editor?.routeOnly, false);
  assert.deepEqual(editor?.paletteIdsByStyle, {});
});

test("sanitizePosterEditor keeps per-style palette lists", () => {
  const editor = sanitizePosterEditor({
    styleIds: ["swiss", "risograph"],
    paletteIdsByStyle: {
      swiss: ["process-blue", "black", ""],
      risograph: ["pink-teal"],
      "": ["auto"],
    },
  });
  assert.deepEqual(editor?.paletteIdsByStyle, {
    swiss: ["process-blue", "black"],
    risograph: ["pink-teal"],
  });
});

test("sanitizePosterEditor ignores missing or invalid payloads", () => {
  assert.equal(sanitizePosterEditor(undefined), undefined);
  assert.equal(sanitizePosterEditor("nope"), undefined);
  assert.equal(sanitizePosterEditor([]), undefined);
});
