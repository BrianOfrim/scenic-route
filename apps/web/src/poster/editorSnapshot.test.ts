import assert from "node:assert/strict";
import { test } from "node:test";
import type { PosterRecord, PosterSpec } from "../api";
import {
  asAspectRatio,
  captureEditorSnapshot,
  restoreEditor,
  styleIdFromRecord,
} from "./editorSnapshot";
import { DEFAULT_FEATURE_IDS } from "./featureCatalog";

const spec = {
  style: {
    name: "Swiss minimal",
    medium: "print poster",
    palette: ["off-white", "red"],
    typography: "Helvetica",
    texture: "paper",
    references: "",
  },
  composition: {
    aspectRatio: "3:4",
    routePlacement: "center",
    titleBlock: "top",
    border: "hairline",
    decorations: [],
  },
  route: {
    treatment: "single accent line",
    color: "red",
    startMarker: "green dot",
    finishMarker: "black dot",
    startName: "Banff",
    finishName: "Lake Louise",
    shapeNotes: "north-south",
  },
  geography: [{ kind: "trail", name: "Bow Valley Parkway", placement: "along route", treatment: "write the name" }],
  landmarks: [{ name: "Castle Mountain", kind: "peak", placement: "upper-right", icon: "peak" }],
  text: {
    title: "Bow Valley",
    subtitle: "42.0 km",
    stats: [{ label: "Distance", value: "42.0 km" }],
    rules: "",
  },
  grounding: {
    images: [{ index: 1, role: "schematic", legend: "red = route" }],
    rules: [],
  },
  negative: [],
  finalPrompt: "Swiss modernist map poster.",
} satisfies PosterSpec;

function record(overrides: Partial<PosterRecord> = {}): PosterRecord {
  return {
    posterId: "p1",
    activityId: 1,
    title: "Bow Valley",
    subtitle: "42.0 km",
    spec,
    prompt: "prompt",
    model: "google/gemini-test",
    aspectRatio: "3:4",
    cost: null,
    createdAt: "2026-09-08T00:00:00Z",
    featureIds: ["lakes", "peaks"],
    labels: ["Castle Mountain"],
    stats: [
      { label: "Title", value: "Bow Valley" },
      { label: "Distance", value: "42.0 km" },
    ],
    styleId: "middle-earth",
    stylePrompt: "Hand-inked map",
    referenceCount: 1,
    url: "/api/posters/p1/image.png",
    ...overrides,
  };
}

const defaults = {
  title: "Ride",
  labels: ["Castle Mountain", "Banff"],
  trailNames: ["Bow Valley Parkway", "Tunnel Mountain"],
  areaNames: ["Banff"],
};

test("asAspectRatio falls back to 2:3", () => {
  assert.equal(asAspectRatio("3:4"), "3:4");
  assert.equal(asAspectRatio("nope"), "2:3");
  assert.equal(asAspectRatio(undefined), "2:3");
});

test("styleIdFromRecord uses a known style or custom", () => {
  assert.equal(styleIdFromRecord(record()), "middle-earth");
  assert.equal(styleIdFromRecord(record({ styleId: "unknown" })), "custom");
});

test("restoreEditor reapplies a full snapshot including crop and annotations", () => {
  const snapshot = captureEditorSnapshot({
    featureIds: ["lakes", "rivers", "peaks"],
    labels: ["Castle Mountain"],
    trailNames: ["Bow Valley Parkway"],
    trailAliases: { "Bow Valley Parkway": "Parkway" },
    areaNames: [],
    customPois: [
      {
        name: "Grandma's mailbox",
        kind: "landmark",
        lat: 51.2,
        lng: -115.5,
        distToRouteM: 12,
        routeFrac: 0.4,
        bearing: "east",
        xy: { x: 0.6, y: 0.4, region: "middle-right" },
        source: "user",
      },
    ],
    customWays: [],
    cropStart: 20,
    cropEnd: 80,
    showRouteMarkers: false,
    title: "Dawn Patrol",
    startPlace: "Banff",
    finishPlace: "Lake Louise",
    placesEdited: true,
    statIds: ["title", "distance"],
    aspectRatio: "16:9",
    styleIds: ["middle-earth", "tron"],
    stylePrompt: "custom ink",
    imageModelIds: ["google/gemini-test"],
    variants: 2,
    specs: { "middle-earth": spec },
    planCosts: { "middle-earth": 0.01 },
  });
  const restored = restoreEditor(record({ editor: snapshot }), 100, defaults);
  assert.deepEqual(restored.featureIds, ["lakes", "rivers", "peaks"]);
  assert.deepEqual(restored.labels, ["Castle Mountain"]);
  assert.deepEqual(restored.trailNames, ["Bow Valley Parkway"]);
  assert.equal(restored.trailAliases["Bow Valley Parkway"], "Parkway");
  assert.deepEqual(restored.areaNames, []);
  assert.equal(restored.customPois[0]?.name, "Grandma's mailbox");
  assert.equal(restored.cropStart, 20);
  assert.equal(restored.cropEnd, 80);
  assert.equal(restored.showRouteMarkers, false);
  assert.equal(restored.title, "Dawn Patrol");
  assert.equal(restored.startPlace, "Banff");
  assert.equal(restored.finishPlace, "Lake Louise");
  assert.equal(restored.placesEdited, true);
  assert.deepEqual(restored.statIds, ["title", "distance"]);
  assert.equal(restored.aspectRatio, "16:9");
  assert.deepEqual(restored.styleIds, ["middle-earth", "tron"]);
  assert.deepEqual(restored.imageModelIds, ["google/gemini-test"]);
  assert.equal(restored.variants, 2);
});

test("restoreEditor clamps crop to the current track", () => {
  const restored = restoreEditor(
    record({
      editor: captureEditorSnapshot({
        featureIds: ["lakes"],
        labels: [],
        trailNames: [],
        trailAliases: {},
        areaNames: [],
        customPois: [],
        customWays: [],
        cropStart: 10,
        cropEnd: 400,
        showRouteMarkers: true,
        title: "Ride",
        startPlace: "",
        finishPlace: "",
        placesEdited: false,
        statIds: ["title"],
        aspectRatio: "2:3",
        styleIds: ["middle-earth"],
        stylePrompt: "",
        imageModelIds: [],
        variants: 4,
        specs: {},
        planCosts: {},
      }),
    }),
    50,
    defaults,
  );
  assert.equal(restored.cropStart, 10);
  assert.equal(restored.cropEnd, 49);
});

test("restoreEditor falls back to saved record fields when no snapshot exists", () => {
  const restored = restoreEditor(record(), 80, defaults);
  assert.deepEqual(restored.featureIds, ["lakes", "peaks"]);
  assert.deepEqual(restored.labels, ["Castle Mountain"]);
  assert.deepEqual(restored.trailNames, defaults.trailNames);
  assert.equal(restored.cropStart, 0);
  assert.equal(restored.cropEnd, 79);
  assert.equal(restored.title, "Bow Valley");
  assert.equal(restored.aspectRatio, "3:4");
  assert.equal(restored.startPlace, "Banff");
  assert.equal(restored.finishPlace, "Lake Louise");
  assert.equal(restored.placesEdited, true);
  assert.deepEqual(restored.styleIds, ["middle-earth"]);
  assert.equal(restored.imageModelIds, null);
  assert.equal(restored.featureIds === DEFAULT_FEATURE_IDS, false);
});
