import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_VARIANTS,
  MAX_VARIANTS,
  clampVariants,
  modifyImageReferences,
  variantImageReferences,
  resolveImagePrompt,
  sanitizePosterEditor,
  toPosterListItem,
  variantCount,
  type PosterRecord,
} from "./poster";
import { SINGLE_ROUTE_RULE, specToImagePrompt, validatePosterSpec } from "./posterSpec";

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
    vibes: "  crisp   fall day  ",
    people: "  Alex,   Jordan  ",
    paletteId: "process-blue",
    imageModelIds: ["google/gemini-test"],
    variants: 2,
    landmarkNearM: { peaks: 250, towns: "1000", skip: "nope" },
  });
  assert.ok(editor);
  assert.deepEqual(editor.featureIds, ["lakes", "peaks"]);
  assert.deepEqual(editor.landmarkNearM, { peaks: 250, towns: 1000 });
  assert.equal(editor.cropStart, 20);
  assert.equal(editor.cropEnd, 80);
  assert.equal(editor.showRouteMarkers, false);
  assert.equal(editor.routeOnly, true);
  assert.equal(editor.customPois.length, 1);
  assert.deepEqual(editor.customWays, []);
  assert.equal(editor.trailAliases["Bow Valley Parkway"], "Parkway");
  assert.equal(editor.variants, 2);
  assert.equal(editor.paletteId, "process-blue");
  assert.equal(editor.vibes, "crisp fall day");
  assert.equal(editor.people, "Alex, Jordan");
  assert.deepEqual(editor.paletteIdsByStyle, {});
  assert.deepEqual(editor.qualities, ["auto"]);
});

test("sanitizePosterEditor defaults paletteId to auto", () => {
  const editor = sanitizePosterEditor({
    styleIds: ["swiss"],
    stylePrompt: "",
  });
  assert.equal(editor?.paletteId, "auto");
  assert.equal(editor?.statUnits, "metric");
  assert.equal(editor?.people, "");
  assert.equal(editor?.routeOnly, false);
  assert.deepEqual(editor?.paletteIdsByStyle, {});
});

test("editor sanitization preserves disabled people drafts and editable display stats", () => {
  const editor = sanitizePosterEditor({ people: "Brian", peopleEnabled: false, location: "", locationMode: "coordinates", dateOverride: "", sportOverride: "Cycling" });
  assert.equal(editor?.people, "Brian");
  assert.equal(editor?.peopleEnabled, false);
  assert.equal(editor?.location, "");
  assert.equal(editor?.locationMode, "coordinates");
  assert.equal(editor?.dateOverride, "");
  assert.equal(editor?.sportOverride, "Cycling");
  assert.equal(sanitizePosterEditor({ people: "Brian" })?.peopleEnabled, true);
});

test("editor sanitization preserves valid distance edits and rejects invalid values", () => {
  for (const distanceOverrideMeters of [0, 10000, 16093.44]) {
    assert.equal(sanitizePosterEditor({ distanceOverrideMeters })?.distanceOverrideMeters, distanceOverrideMeters);
  }
  for (const distanceOverrideMeters of [-1, Infinity, NaN, "10000"]) {
    assert.equal(sanitizePosterEditor({ distanceOverrideMeters })?.distanceOverrideMeters, null);
  }
});

test("saved geography mode and scene identity are validated", () => {
  const editor = sanitizePosterEditor({ geographyMode: "auto", routeDetail: false, geographyPolicyVersion: 1,
    geographySceneId: "a".repeat(64), geographyFrameKey: "frame", featureIds: [] });
  assert.equal(editor?.geographyMode, "auto");
  assert.equal(editor?.routeDetail, false);
  assert.equal(editor?.detailScope, "none");
  assert.equal(sanitizePosterEditor({ detailScope: "all" })?.detailScope, "all");
  assert.equal(sanitizePosterEditor({})?.routeDetail, true);
  assert.equal(editor?.geographySceneId, "a".repeat(64));
  assert.deepEqual(editor?.featureIds, []);
  assert.equal(sanitizePosterEditor({})?.geographyMode, "manual");
  assert.equal(sanitizePosterEditor({ geographySceneId: "../../secret" })?.geographySceneId, undefined);
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

test("sanitizePosterEditor preserves shared endpoint choices", () => {
  assert.equal(sanitizePosterEditor({ sharedPlace: true })?.sharedPlace, true);
  assert.equal(sanitizePosterEditor({ sharedPlace: false })?.sharedPlace, false);
  assert.equal(sanitizePosterEditor({ sharedPlace: "false" })?.sharedPlace, null);
  assert.equal(sanitizePosterEditor({})?.sharedPlace, null);
});

test("sanitizePosterEditor ignores missing or invalid payloads", () => {
  assert.equal(sanitizePosterEditor(undefined), undefined);
  assert.equal(sanitizePosterEditor("nope"), undefined);
  assert.equal(sanitizePosterEditor([]), undefined);
});

test("modifyImageReferences puts the previous poster first and respects the cap", () => {
  assert.deepEqual(modifyImageReferences("poster", ["schematic", "satellite"], 3), [
    "poster",
    "schematic",
    "satellite",
  ]);
  assert.deepEqual(modifyImageReferences("poster", ["schematic", "satellite"], 2), ["poster", "schematic"]);
  assert.deepEqual(modifyImageReferences("poster", ["schematic"], 1), ["poster"]);
  assert.deepEqual(modifyImageReferences("poster", ["", "schematic"], 3), ["poster", "schematic"]);
});

test("variantImageReferences keeps grounding and drops any previous poster", () => {
  assert.deepEqual(variantImageReferences(["schematic", "satellite"], 3), ["schematic", "satellite"]);
  assert.deepEqual(variantImageReferences(["schematic", "satellite"], 1), ["schematic"]);
  assert.deepEqual(variantImageReferences(["", "schematic"], 3), ["schematic"]);
});

test("resolveImagePrompt prefers a non-empty override", () => {
  const spec = validatePosterSpec({
    style: {
      name: "Swiss minimal",
      medium: "print",
      palette: ["off-white"],
      typography: "Helvetica",
      texture: "",
      references: "",
    },
    composition: {
      aspectRatio: "2:3",
      routePlacement: "center",
      titleBlock: "top",
      border: "",
      decorations: [],
    },
    route: {
      treatment: "line",
      color: "red",
      startMarker: "dot",
      finishMarker: "dot",
      shapeNotes: "",
    },
    geography: [],
    landmarks: [],
    text: { title: "Ride", subtitle: "", stats: [], rules: "" },
    grounding: { images: [{ index: 1, role: "schematic", legend: "" }], rules: [] },
    negative: [],
    finalPrompt: "assembled from spec",
  });
  assert.equal(resolveImagePrompt(spec, "  warmer paper  "), `${SINGLE_ROUTE_RULE}\n\nwarmer paper`);
  const savedPrompt = resolveImagePrompt(spec, "warmer paper");
  assert.equal(resolveImagePrompt(spec, savedPrompt), savedPrompt);
  assert.equal(resolveImagePrompt(spec, "   "), specToImagePrompt(spec));
});

test("toPosterListItem drops prompt, spec, and editor and points cards at the thumb", () => {
  const spec = validatePosterSpec({
    style: {
      name: "Custom wash",
      medium: "print",
      palette: ["off-white"],
      typography: "Helvetica",
      texture: "",
      references: "",
    },
    composition: {
      aspectRatio: "2:3",
      routePlacement: "center",
      titleBlock: "top",
      border: "",
      decorations: [],
    },
    route: {
      treatment: "line",
      color: "red",
      startMarker: "dot",
      finishMarker: "dot",
      shapeNotes: "",
    },
    geography: [],
    landmarks: [],
    text: { title: "Ride", subtitle: "", stats: [], rules: "" },
    grounding: { images: [{ index: 1, role: "schematic", legend: "" }], rules: [] },
    negative: [],
    finalPrompt: "a very long assembled prompt",
  });
  const record: PosterRecord = {
    posterId: "20260101T000000Z-abc123",
    activityId: 7,
    title: "Ride",
    subtitle: "",
    spec,
    prompt: "a very long assembled prompt plus editor geometry",
    model: "google/gemini-test",
    aspectRatio: "2:3",
    cost: 0.1,
    createdAt: "2026-09-24T00:00:00Z",
    featureIds: ["lakes"],
    labels: ["Peak"],
    stats: [{ label: "Distance", value: "10 km" }],
    styleId: "custom",
    stylePrompt: "ink",
    referenceCount: 1,
    url: "/api/posters/20260101T000000Z-abc123/image.png",
    editor: sanitizePosterEditor({ cropStart: 0, cropEnd: 1, title: "Ride" }),
  };
  const listed = toPosterListItem(record);
  assert.equal(listed.spec, undefined);
  assert.equal(listed.prompt, undefined);
  assert.equal(listed.editor, undefined);
  assert.equal(listed.featureIds, undefined);
  assert.equal(listed.labels, undefined);
  assert.equal(listed.stats, undefined);
  assert.equal(listed.stylePrompt, undefined);
  assert.equal(listed.styleName, "Custom wash");
  assert.equal(listed.thumbUrl, "/api/posters/20260101T000000Z-abc123/thumb.webp");
  assert.equal(listed.url, "/api/posters/20260101T000000Z-abc123/image.png");
  assert.equal(listed.title, "Ride");
});
