import assert from "node:assert/strict";
import { test } from "node:test";
import type { PosterRecord, PosterSpec } from "../api";
import {
  asAspectRatio,
  captureEditorSnapshot,
  featureIdsToResolveNames,
  namesFromPrompt,
  restoreEditor,
  savedSetupNames,
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

test("legacy geography stays manual; automatic scene identity and explicit empty selections restore", () => {
  const legacy = restoreEditor(record({ spec: undefined, prompt: "", labels: [], featureIds: [] }), 10, defaults);
  assert.equal(legacy.geographyMode, "manual");
  const snapshot = captureEditorSnapshot({ ...legacy, geographyMode: "auto", routeDetail: false, detailScope: "none", geographyPolicyVersion: 1,
    geographySceneId: "a".repeat(64), geographyFrameKey: "frame", featureIds: [], labels: [], trailNames: [], areaNames: [],
    imageModelIds: [], variants: 1, qualities: [] });
  const restored = restoreEditor(record({ spec: undefined, prompt: "", labels: [], editor: snapshot }), 10, defaults);
  assert.equal(restored.geographyMode, "auto");
  assert.equal(restored.routeDetail, false);
  assert.equal(restored.detailScope, "none");
  const everywhere = { ...snapshot, detailScope: "all" as const };
  assert.equal(restoreEditor(record({ spec: undefined, prompt: "", labels: [], editor: everywhere }), 10, defaults).detailScope, "all");
  const priorPoster = { ...snapshot, routeDetail: true, detailScope: "route" as const };
  assert.equal(restoreEditor(record({ spec: undefined, prompt: "", labels: [], editor: priorPoster }), 10, defaults).detailScope, "route");
  assert.equal(restored.geographySceneId, "a".repeat(64));
  assert.equal(restored.geographyPolicyVersion, 1);
  assert.deepEqual(restored.featureIds, []);
});

test("asAspectRatio falls back to 3:4", () => {
  assert.equal(asAspectRatio("4:5"), "3:4");
  assert.equal(asAspectRatio("2:3"), "2:3");
  assert.equal(asAspectRatio("3:4"), "3:4");
  assert.equal(asAspectRatio("nope"), "3:4");
  assert.equal(asAspectRatio(undefined), "3:4");
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
    routeOnly: true,
    title: "Dawn Patrol",
    startPlace: "Banff",
    finishPlace: "Lake Louise",
    placesEdited: true,
    statIds: ["title", "distance"],
    aspectRatio: "16:9",
    styleIds: ["middle-earth", "blueprint"],
    stylePrompt: "custom ink",
    vibes: "A nice, crisp fall day. Leaves were beautiful colours!",
    paletteId: "red",
    imageModelIds: ["google/gemini-test"],
    variants: 2,
    specs: { "middle-earth": spec },
    planCosts: { "middle-earth": 0.01 },
    landmarkNearM: { peaks: 250, towns: 1500 },
  });
  const restored = restoreEditor(record({ editor: snapshot }), 100, defaults);
  assert.deepEqual(restored.featureIds, ["lakes", "rivers", "peaks"]);
  assert.deepEqual(restored.landmarkNearM, { peaks: 250, towns: 1500 });
  assert.deepEqual(restored.labels, ["Castle Mountain"]);
  assert.deepEqual(restored.trailNames, ["Bow Valley Parkway"]);
  assert.equal(restored.trailAliases["Bow Valley Parkway"], "Parkway");
  assert.deepEqual(restored.areaNames, []);
  assert.equal(restored.customPois[0]?.name, "Grandma's mailbox");
  assert.equal(restored.cropStart, 20);
  assert.equal(restored.cropEnd, 80);
  assert.equal(restored.showRouteMarkers, false);
  assert.equal(restored.routeOnly, true);
  assert.equal(restored.title, "Dawn Patrol");
  assert.equal(restored.startPlace, "Banff");
  assert.equal(restored.finishPlace, "Lake Louise");
  assert.equal(restored.placesEdited, true);
  assert.deepEqual(restored.statIds, ["title", "distance"]);
  assert.equal(restored.aspectRatio, "16:9");
  assert.deepEqual(restored.styleIds, ["middle-earth", "blueprint"]);
  assert.equal(restored.vibes, "A nice, crisp fall day. Leaves were beautiful colours!");
  assert.equal(restored.paletteId, "auto");
  assert.deepEqual(restored.paletteIdsByStyle, { "middle-earth": ["auto"], blueprint: ["auto"] });
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
        paletteId: "auto",
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

test("restoreEditor keeps a costume palette on a single theme", () => {
  const snapshot = captureEditorSnapshot({
    featureIds: ["lakes"],
    labels: [],
    trailNames: [],
    trailAliases: {},
    areaNames: [],
    customPois: [],
    customWays: [],
    cropStart: 0,
    cropEnd: 10,
    showRouteMarkers: true,
    title: "Ride",
    startPlace: "",
    finishPlace: "",
    placesEdited: false,
    statIds: ["title"],
    aspectRatio: "2:3",
    styleIds: ["swiss"],
    stylePrompt: "",
    paletteId: "process-blue",
    imageModelIds: [],
    variants: 4,
    specs: {},
    planCosts: {},
  });
  const restored = restoreEditor(record({ editor: snapshot }), 20, defaults);
  assert.equal(restored.paletteId, "process-blue");
  assert.deepEqual(restored.paletteIdsByStyle, { swiss: ["process-blue"] });
});

test("restoreEditor keeps per-style palettes and multiple palettes on one style", () => {
  const snapshot = captureEditorSnapshot({
    featureIds: ["lakes"],
    labels: [],
    trailNames: [],
    trailAliases: {},
    areaNames: [],
    customPois: [],
    customWays: [],
    cropStart: 0,
    cropEnd: 10,
    showRouteMarkers: true,
    title: "Ride",
    startPlace: "",
    finishPlace: "",
    placesEdited: false,
    statIds: ["title"],
    aspectRatio: "2:3",
    styleIds: ["swiss", "risograph"],
    stylePrompt: "",
    paletteIdsByStyle: {
      swiss: ["process-blue", "black"],
      risograph: ["pink-teal"],
    },
    imageModelIds: [],
    variants: 4,
    specs: {},
    planCosts: {},
  });
  const restored = restoreEditor(record({ editor: snapshot }), 20, defaults);
  assert.deepEqual(restored.paletteIdsByStyle.swiss, ["process-blue", "black"]);
  assert.deepEqual(restored.paletteIdsByStyle.risograph, ["pink-teal"]);
  assert.equal(restored.paletteId, "process-blue");
});

test("restoreEditor still accepts a legacy single paletteId", () => {
  const snapshot = captureEditorSnapshot({
    featureIds: ["lakes"],
    labels: [],
    trailNames: [],
    trailAliases: {},
    areaNames: [],
    customPois: [],
    customWays: [],
    cropStart: 0,
    cropEnd: 10,
    showRouteMarkers: true,
    title: "Ride",
    startPlace: "",
    finishPlace: "",
    placesEdited: false,
    statIds: ["title"],
    aspectRatio: "2:3",
    styleIds: ["swiss"],
    stylePrompt: "",
    paletteId: "signal-yellow",
    imageModelIds: [],
    variants: 4,
    specs: {},
    planCosts: {},
  });
  const restored = restoreEditor(record({ editor: snapshot }), 20, defaults);
  assert.deepEqual(restored.paletteIdsByStyle, { swiss: ["signal-yellow"] });
});

test("restoreEditor falls back to saved record fields when no snapshot exists", () => {
  const restored = restoreEditor(record(), 80, defaults);
  assert.deepEqual(restored.featureIds, ["lakes", "peaks"]);
  assert.deepEqual(restored.labels, ["Castle Mountain"]);
  assert.deepEqual(restored.trailNames, ["Bow Valley Parkway"]);
  assert.equal(restored.cropStart, 0);
  assert.equal(restored.cropEnd, 79);
  assert.equal(restored.title, "Bow Valley");
  assert.equal(restored.routeOnly, false);
  assert.equal(restored.aspectRatio, "3:4");
  assert.equal(restored.startPlace, "Banff");
  assert.equal(restored.finishPlace, "Lake Louise");
  assert.equal(restored.placesEdited, true);
  assert.deepEqual(restored.styleIds, ["middle-earth"]);
  assert.equal(restored.paletteId, "auto");
  assert.equal(restored.imageModelIds, null);
  assert.equal(restored.featureIds === DEFAULT_FEATURE_IDS, false);
});

test("namesFromPrompt reads labeled districts and quoted landmarks", () => {
  const playground = namesFromPrompt(
    [
      "The map shows hand-lettered names for Jubilee Park, Rudy Swanson Recreation Park, and University of Alberta - Augustana Campus.",
      "",
      "Geography: labeled district University of Alberta - Augustana Campus (middle-right, northeast of the route; write the name along that stretch); labeled district Rudy Swanson Recreation Park (upper-center, northwest of the route; write the name); labeled district Jubilee Park (upper-center, north of the route; write the name).",
      "",
      "Reference images: image 1 is the schematic.",
    ].join("\n"),
  );
  assert.deepEqual(playground.areaNames, [
    "University of Alberta - Augustana Campus",
    "Rudy Swanson Recreation Park",
    "Jubilee Park",
  ]);
  assert.deepEqual(playground.labels, []);

  const landmarks = namesFromPrompt(
    [
      "Geography: water Mirror Lake and connected streams (upper-center; wash fills); forest Woodland (flanking the route).",
      "",
      'Landmarks: do not draw the numbers. 1 "Mirror Lake" (upper-center; icon: water-label); 2 "Jubilee Park" (middle-right; icon: park-marker).',
      "",
      'Title, exactly: "Pedals & Pints ride".',
    ].join("\n"),
  );
  assert.deepEqual(landmarks.labels, ["Mirror Lake"]);
  assert.deepEqual(landmarks.areaNames, ["Jubilee Park"]);
});

test("restoreEditor prefers generation-time names over live OSM defaults", () => {
  const restored = restoreEditor(
    record({
      featureIds: [],
      labels: [],
      spec: {
        ...spec,
        geography: [],
        landmarks: [],
        finalPrompt: [
          "Geography: labeled district Jubilee Park (north of the route; write the name); labeled district Rudy Swanson Recreation Park (northwest of the route; write the name).",
          "",
          "Reference images: image 1 is the schematic.",
        ].join("\n"),
      },
      prompt: "unused",
    }),
    80,
    {
      title: "Ride",
      labels: ["Cascades Park", "Rotary Park"],
      trailNames: ["Ghost trail"],
      areaNames: ["Cascades Park", "Rotary Park"],
    },
  );
  assert.deepEqual(restored.areaNames, ["Jubilee Park", "Rudy Swanson Recreation Park"]);
  assert.deepEqual(restored.labels, []);
  assert.ok(restored.featureIds.includes("named-parks"));
  assert.ok(!restored.areaNames.includes("Cascades Park"));
});

test("savedSetupNames keeps an explicit editor snapshot", () => {
  const snapshot = captureEditorSnapshot({
    featureIds: ["named-parks"],
    labels: [],
    trailNames: [],
    trailAliases: {},
    areaNames: ["Jubilee Park"],
    customPois: [],
    customWays: [],
    cropStart: 0,
    cropEnd: 10,
    showRouteMarkers: true,
    title: "Ride",
    startPlace: "",
    finishPlace: "",
    placesEdited: false,
    statIds: ["title"],
    aspectRatio: "2:3",
    styleIds: ["middle-earth"],
    stylePrompt: "",
    paletteId: "auto",
    imageModelIds: [],
    variants: 4,
    specs: {},
    planCosts: {},
  });
  assert.deepEqual(savedSetupNames(record({ editor: snapshot, labels: [] })), {
    labels: [],
    trailNames: [],
    areaNames: ["Jubilee Park"],
  });
});

test("featureIdsToResolveNames leaves an explicit landmark set alone", () => {
  assert.deepEqual(
    featureIdsToResolveNames(["lakes", "peaks"], { labels: ["Castle Mountain"], trailNames: [], areaNames: [] }),
    ["lakes", "peaks"],
  );
});

test("featureIdsToResolveNames migrates the legacy Strava trail layer", () => {
  assert.deepEqual(
    featureIdsToResolveNames(["lakes", "strava-segments"], {
      labels: [],
      trailNames: ["North Shore"],
      areaNames: [],
    }),
    ["lakes", "named-trails"],
  );
});

test("namesFromPrompt ignores style clauses after hand-lettered place names", () => {
  const names = namesFromPrompt(
    "The map shows hand-lettered names for Jubilee Park, Rudy Swanson Recreation Park, and University of Alberta - Augustana Campus, an ornate fantasy compass rose, and an illuminated title cartouche reading 'Ride'.",
  );
  assert.deepEqual(names.labels, [
    "Jubilee Park",
    "Rudy Swanson Recreation Park",
    "University of Alberta - Augustana Campus",
  ]);
});
