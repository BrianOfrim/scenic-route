import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUsableSpec, buildPlannerMessages, repairPlannerOutput, type PlannerInput } from "./planner";
import { specToImagePrompt, validatePosterSpec } from "./posterSpec";

const input: PlannerInput = {
  activity: { name: "Lunch ride", sportType: "Ride", isLoop: true },
  routeMarkers: { enabled: true, mode: "loop" },
  title: "Lunch ride",
  subtitle: "12.4 km · 41 min",
  stats: [{ label: "Distance", value: "12.4 km" }],
  style: {
    id: "swiss",
    label: "Swiss minimal",
    prompt: "Swiss modernist map poster",
    palette: ["off-white", "red"],
    typography: "Helvetica",
  },
  customStylePrompt: "more negative space",
  aspectRatio: "2:3",
  geography: [{ id: "lakes", label: "Lakes & ponds" }],
  pois: [
    {
      name: "Norsemen Inn",
      kind: "pub",
      lat: 53.02,
      lng: -112.83,
      distToRouteM: 40,
      routeFrac: 0.12,
      bearing: "west",
      xy: { x: 0.2, y: 0.3, region: "upper-left" },
    },
  ],
  grounding: [{ index: 1, role: "schematic", legend: "red = route" }],
};

test("buildPlannerMessages includes landmarks and grounding roles", () => {
  const messages = buildPlannerMessages(input);
  assert.equal(messages.length, 2);
  assert.match(String(messages[0].content), /geographic source of truth/);
  assert.match(String(messages[0].content), /GPS track on the schematic is exact/);
  assert.match(String(messages[0].content), /satellite image/);
  assert.match(String(messages[0].content), /real aerial photography/);
  assert.match(String(messages[0].content), /every separate stroke/i);
  assert.match(String(messages[0].content), /do not redesign it/i);
  assert.match(String(messages[0].content), /optional finalPrompt/);
  assert.match(String(messages[0].content), /combined start\/finish marker/);
  assert.match(String(messages[0].content), /write those names at the schematic start\/finish marker/);
  assert.match(String(messages[0].content), /not title-block stats/);
  assert.match(String(messages[0].content), /never a prose string in place of an object/);
  assert.match(String(messages[0].content), /Do not request a scale bar/);
  assert.match(String(messages[0].content), /16% of the poster width/);
  assert.match(String(messages[0].content), /clearly readable when the whole poster is viewed on a phone/);
  assert.match(String(messages[0].content), /Do not add a title when the design has none/);
  assert.match(String(messages[0].content), /do not invent one/);
  assert.match(String(messages[0].content), /private index/);
  assert.match(String(messages[0].content), /never copy the numbers/);
  assert.match(String(messages[0].content), /small marker on the route/);
  assert.match(String(messages[0].content), /never occlude, break, or replace the route/);
  assert.match(String(messages[0].content), /one line in route.color/);
  assert.match(String(messages[0].content), /highest-contrast primary mark/);
  assert.match(String(messages[0].content), /title block only in unused negative space/i);
  assert.match(String(messages[0].content), /do not copy the schematic's route colors/);
  assert.match(String(messages[0].content), /"landmarks":\[\{"name":""/);
  const user = JSON.parse(String(messages[1].content)) as {
    landmarks: Array<Record<string, unknown>>;
    namedTrails: Array<Record<string, unknown>>;
    namedRegions: Array<Record<string, unknown>>;
    customStylePrompt: string;
    groundingImages: Array<{ role: string }>;
    routeMarkers: { enabled: boolean; mode: string };
    routeOnly: boolean;
  };
  assert.equal(user.landmarks[0].name, "Norsemen Inn");
  assert.equal(user.landmarks[0].pin, 1);
  assert.equal(user.landmarks[0].placement, "upper-left, west of the route");
  assert.equal(user.landmarks[0].proximity, "on the route");
  assert.equal(user.landmarks[0].routeProgressPct, 12);
  assert.equal("lat" in user.landmarks[0], false, "planner payload should not carry coordinates");
  assert.deepEqual(user.namedTrails, []);
  assert.deepEqual(user.namedRegions, []);
  assert.match(String(messages[0].content), /Named trails recolor stretches/);
  assert.match(String(messages[0].content), /Named regions are pale ochre washes/);
  assert.match(String(messages[0].content), /letter as a private name index/);
  assert.match(String(messages[0].content), /lettered wash is the exact footprint/);
  assert.match(String(messages[0].content), /same place and extent as the wash/);
  assert.match(String(messages[0].content), /Never copy the schematic's brown or ochre wash/);
  assert.match(String(messages[0].content), /parks and green space as green/);
  assert.match(String(messages[0].content), /never copy the letters/);
  assert.equal(user.customStylePrompt, "more negative space");
  assert.equal(user.groundingImages[0].role, "schematic");
  assert.deepEqual(user.routeMarkers, { enabled: true, mode: "loop" });
  assert.equal(user.routeOnly, false);
});

test("buildPlannerMessages in route-only mode drops named features", () => {
  const messages = buildPlannerMessages({
    ...input,
    routeOnly: true,
  });
  const system = String(messages[0].content);
  const user = JSON.parse(String(messages[1].content)) as {
    routeOnly: boolean;
    landmarks: unknown[];
    namedTrails: unknown[];
    namedRegions: unknown[];
    geographyLayers: unknown[];
  };
  assert.equal(user.routeOnly, true);
  assert.deepEqual(user.landmarks, []);
  assert.deepEqual(user.namedTrails, []);
  assert.deepEqual(user.namedRegions, []);
  assert.deepEqual(user.geographyLayers, input.geography);
  assert.match(system, /no annotations/);
  assert.match(system, /landmarks must be empty/);
  assert.match(system, /geography may describe unlabeled layers/);
  assert.doesNotMatch(system, /Named trails recolor stretches/);
  assert.doesNotMatch(system, /Named regions are pale ochre washes/);
  assert.doesNotMatch(system, /numbered discs as a private index/);
});

test("repairPlannerOutput in route-only mode strips landmarks and named geography", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Swiss", medium: "print", palette: ["red"], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "dot", finishMarker: "dot", shapeNotes: "" },
      geography: [
        { kind: "trail", name: "River Valley Trail", placement: "along route", treatment: "write the name" },
        {
          kind: "water",
          name: "Lakes and rivers",
          placement: "background shapes",
          treatment: "flat blue lakes",
          color: "navy",
        },
      ],
      landmarks: [{ name: "Norsemen Inn", kind: "pub", placement: "upper-left", icon: "pub", pin: 1 }],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "",
    },
    { ...input, routeOnly: true },
  );
  const spec = validatePosterSpec(repaired);
  assert.deepEqual(spec.landmarks, []);
  assert.deepEqual(
    spec.geography.map((item) => [item.kind, item.name, item.treatment, item.color]),
    [["water", "", "flat blue lakes", undefined]],
  );
  const prompt = specToImagePrompt(spec);
  assert.match(prompt, /Geography: water/);
  assert.match(prompt, /unlabeled background map/i);
  assert.doesNotMatch(prompt, /route-only poster: only the GPS track/i);
});

test("repairPlannerOutput coerces prose fields into the nested shape", () => {
  const repaired = repairPlannerOutput(
    {
      style: "Swiss modernist print on off-white paper",
      composition: "route centered, title at the bottom",
      route: "thick red line with a gold loop marker",
      geography: "flat blue lakes; pale grey roads",
      landmarks: ["Norsemen Inn — pub, upper-left", "Camrose (center)"],
      text: "exact spelling only",
      grounding: "follow image 1",
      negative: "photorealism, clutter",
    },
    input,
  );
  const spec = validatePosterSpec(repaired);
  assert.equal(spec.style.medium, "Swiss modernist print on off-white paper");
  assert.equal(spec.style.name, "Swiss minimal");
  assert.deepEqual(spec.style.palette, ["off-white", "red"]);
  assert.match(spec.style.typography, /^Helvetica\. Large display title/);
  assert.match(spec.style.typography, /16% of the poster width/);
  assert.match(spec.composition.titleBlock, /Large display title, clearly readable when the whole poster is viewed on a phone/);
  assert.equal(spec.composition.routePlacement, "route centered, title at the bottom");
  assert.equal(spec.composition.aspectRatio, "2:3");
  assert.equal(spec.route.treatment, "thick red line with a gold loop marker");
  assert.deepEqual(
    spec.geography.map((item) => item.treatment),
    ["flat blue lakes", "pale grey roads"],
  );
  assert.deepEqual(
    spec.landmarks.map((item) => [item.pin, item.name, item.placement]),
    [
      [1, "Norsemen Inn", "pub, upper-left"],
      [2, "Camrose", "center"],
    ],
  );
  assert.equal(spec.text.title, "Lunch ride");
  assert.equal(spec.text.subtitle, "12.4 km · 41 min");
  assert.deepEqual(spec.text.stats, [{ label: "Distance", value: "12.4 km" }]);
  assert.match(spec.text.rules, /^exact spelling only\. Set the title as a large display title/);
  assert.match(spec.text.rules, /Do not add a title when the design has none/);
  assert.deepEqual(spec.grounding.images, [{ index: 1, role: "schematic", legend: "red = route" }]);
  assert.deepEqual(spec.grounding.rules, ["follow image 1"]);
  assert.deepEqual(spec.negative, ["photorealism", "clutter"]);
  assertUsableSpec(spec);
});

test("repairPlannerOutput leaves well-formed output alone and forces markers off", () => {
  const good = {
    style: { name: "Blueprint", medium: "cyanotype", palette: ["navy", "white"], typography: "mono", texture: "", references: "" },
    composition: { aspectRatio: "3:4", routePlacement: "center", titleBlock: "bottom", border: "none", decorations: [] },
    route: { treatment: "white line", color: "white", startMarker: "dot", finishMarker: "dot", shapeNotes: "" },
    geography: [],
    landmarks: [],
    text: { title: "T", subtitle: "S", stats: [], rules: "" },
    grounding: { images: [{ index: 1, role: "schematic", legend: "" }], rules: [] },
    negative: [],
    finalPrompt: "",
  };
  const repaired = repairPlannerOutput(good, { ...input, routeMarkers: { enabled: false, mode: "loop" } });
  const spec = validatePosterSpec(repaired);
  assert.equal(spec.style.name, "Blueprint");
  assert.equal(spec.composition.aspectRatio, "3:4");
  assert.equal(spec.text.title, "T");
  assert.equal(spec.route.startMarker, "none");
  assert.equal(spec.route.finishMarker, "none");
});

test("repairPlannerOutput stamps start and finish place names from routeMarkers", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Blueprint", medium: "cyanotype", palette: ["navy"], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "green dot", finishMarker: "black dot", shapeNotes: "" },
      geography: [],
      landmarks: [],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "",
    },
    {
      ...input,
      routeMarkers: { enabled: true, mode: "start-finish", startName: "Camrose", finishName: "Edmonton" },
    },
  );
  const spec = validatePosterSpec(repaired);
  assert.equal(spec.route.startName, "Camrose");
  assert.equal(spec.route.finishName, "Edmonton");
  assert.match(specToImagePrompt(spec), /Write "Camrose" at the start marker and "Edmonton" at the finish marker/);
});

test("repairPlannerOutput stamps schematic pin numbers by landmark name", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Swiss", medium: "print", palette: [], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "none", finishMarker: "none", shapeNotes: "" },
      geography: [],
      landmarks: [
        { name: "Augustana", kind: "college", placement: "center", icon: "campus" },
        { name: "Norsemen Inn", kind: "pub", placement: "upper-left", icon: "" },
      ],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "x",
    },
    {
      ...input,
      pois: [
        input.pois[0],
        {
          ...input.pois[0],
          name: "Augustana",
          kind: "college",
          routeFrac: 0.5,
          xy: { x: 0.5, y: 0.5, region: "center" },
        },
      ],
    },
  );
  const spec = validatePosterSpec(repaired);
  assert.deepEqual(
    spec.landmarks.map((item) => [item.pin, item.name]),
    [
      [2, "Augustana"],
      [1, "Norsemen Inn"],
    ],
  );
});

const augustanaArea = {
  name: "Augustana",
  kind: "university",
  geometry: {
    type: "Polygon" as const,
    coordinates: [[[-112.84, 53.01], [-112.82, 53.01], [-112.82, 53.03], [-112.84, 53.03], [-112.84, 53.01]]],
  },
  lat: 53.02,
  lng: -112.83,
  distToRouteM: 30,
  routeFrac: 0.5,
  bearing: "east",
  xy: { x: 0.6, y: 0.5, region: "middle-right" },
};

const porcupineTrail = {
  name: "Porcupine Rim",
  kind: "trail",
  geometry: { type: "MultiLineString" as const, coordinates: [[[-109.5, 38.6], [-109.49, 38.599]]] },
  lat: 38.6,
  lng: -109.5,
  distToRouteM: 20,
  routeFrac: 0.3,
  bearing: "east",
  xy: { x: 0.7, y: 0.4, region: "upper-right" },
  colorName: "teal",
};

test("buildPlannerMessages sends named trail colors without geometry", () => {
  const messages = buildPlannerMessages({ ...input, namedWays: [porcupineTrail] });
  const user = JSON.parse(String(messages[1].content)) as {
    namedTrails: Array<Record<string, unknown>>;
  };
  assert.equal(user.namedTrails[0].name, "Porcupine Rim");
  assert.equal(user.namedTrails[0].color, "teal");
  assert.equal(user.namedTrails[0].treatment, "write the name along that stretch");
  assert.doesNotMatch(String(user.namedTrails[0].treatment), /teal stretch/);
  assert.equal("geometry" in user.namedTrails[0], false);
  assert.equal("lat" in user.namedTrails[0], false);
});

test("repairPlannerOutput injects named trails into geography", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Swiss", medium: "print", palette: [], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "none", finishMarker: "none", shapeNotes: "" },
      geography: [{ kind: "water", name: "lake", placement: "left", treatment: "flat blue" }],
      landmarks: [],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "x",
    },
    { ...input, namedWays: [porcupineTrail] },
  );
  const spec = validatePosterSpec(repaired);
  assert.equal(spec.geography[1].name, "Porcupine Rim");
  assert.equal(spec.geography[1].color, "teal");
  assert.equal(spec.geography[1].treatment, "write the name along that stretch");
  assert.doesNotMatch(spec.geography[1].treatment, /teal stretch/);
});

test("repairPlannerOutput strips legacy teal-stretch treatments", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Swiss", medium: "print", palette: [], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "none", finishMarker: "none", shapeNotes: "" },
      geography: [
        {
          kind: "trail",
          name: "Porcupine Rim",
          placement: "upper-right",
          treatment: "teal stretch of the GPS track, write the name along that stretch",
        },
      ],
      landmarks: [],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "Paint the teal stretch of the GPS track.",
    },
    { ...input, namedWays: [porcupineTrail] },
  );
  const spec = validatePosterSpec(repaired);
  assert.equal(spec.geography[0].color, "teal");
  assert.equal(spec.geography[0].treatment, "write the name along that stretch");
  assert.doesNotMatch(specToImagePrompt(spec), /teal stretch of the GPS track/);
});

test("buildPlannerMessages sends named regions and one-level inside clauses", () => {
  const messages = buildPlannerMessages({
    ...input,
    pois: [{ ...input.pois[0], inside: "Augustana" }],
    namedAreas: [augustanaArea],
  });
  const user = JSON.parse(String(messages[1].content)) as {
    landmarks: Array<Record<string, unknown>>;
    namedRegions: Array<Record<string, unknown>>;
  };
  assert.equal(user.landmarks[0].placement, "upper-left, west of the route, inside Augustana");
  assert.equal(user.namedRegions[0].name, "Augustana");
  assert.equal(user.namedRegions[0].kind, "university");
  assert.equal(user.namedRegions[0].letter, "A");
  assert.match(String(user.namedRegions[0].treatment), /same place as the schematic letter/);
  assert.match(String(user.namedRegions[0].treatment), /not schematic ochre/);
  assert.equal("geometry" in user.namedRegions[0], false);
});

test("repairPlannerOutput injects named regions and drops them from landmarks", () => {
  const repaired = repairPlannerOutput(
    {
      style: { name: "Swiss", medium: "print", palette: [], typography: "", texture: "", references: "" },
      composition: { aspectRatio: "2:3", routePlacement: "center", titleBlock: "top", border: "", decorations: [] },
      route: { treatment: "line", color: "red", startMarker: "none", finishMarker: "none", shapeNotes: "" },
      geography: [{ kind: "water", name: "lake", placement: "left", treatment: "flat blue" }],
      landmarks: [
        { name: "Augustana", kind: "university", placement: "center", icon: "campus" },
        { name: "Norsemen Inn", kind: "pub", placement: "upper-left", icon: "" },
      ],
      text: { title: "T", subtitle: "S", stats: [], rules: "" },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "x",
    },
    { ...input, namedAreas: [augustanaArea] },
  );
  const spec = validatePosterSpec(repaired);
  assert.deepEqual(
    spec.geography.map((item) => item.name),
    ["lake", "Augustana"],
  );
  assert.match(spec.geography[1].treatment, /same place as the schematic letter/);
  assert.match(spec.geography[1].treatment, /not schematic ochre/);
  assert.equal(spec.geography[1].letter, "A");
  assert.deepEqual(
    spec.landmarks.map((item) => item.name),
    ["Norsemen Inn"],
  );
});

test("assertUsableSpec rejects a spec with no style or route direction", () => {
  const empty = validatePosterSpec({ text: { title: "x" }, finalPrompt: "y" });
  assert.throws(() => assertUsableSpec(empty), /unusable spec/);
});

test("planner asks for an open palette instead of refilling a cliché pair", () => {
  const openInput: PlannerInput = {
    ...input,
    style: {
      id: "risograph",
      label: "Risograph",
      prompt: "Two-ink risograph print. Pick any two Riso inks.",
      palette: [],
      typography: "zine sans",
      openPalette: true,
    },
  };
  const messages = buildPlannerMessages(openInput);
  assert.match(String(messages[0].content), /no fixed palette/);
  assert.match(String(messages[0].content), /Do not fall back to a cliché pair/);
  const user = JSON.parse(String(messages[1].content)) as {
    stylePreset: { palette: string[]; openPalette: boolean };
    paletteInstruction: string;
  };
  assert.deepEqual(user.stylePreset.palette, []);
  assert.equal(user.stylePreset.openPalette, true);
  assert.match(user.paletteInstruction, /no fixed palette/);
  const repaired = repairPlannerOutput(
    {
      style: { name: "Risograph", medium: "risograph", palette: [], typography: "zine sans" },
      composition: { routePlacement: "center" },
      route: { treatment: "loud ink", color: "the louder ink" },
    },
    openInput,
  );
  const spec = validatePosterSpec(repaired);
  assert.deepEqual(spec.style.palette, []);
});

test("repairPlannerOutput does not invent a title when the design has none", () => {
  const repaired = repairPlannerOutput(
    {
      style: {
        name: "Swiss",
        medium: "print",
        palette: ["red"],
        typography:
          "Helvetica. Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 16% of the poster width.",
        texture: "",
        references: "",
      },
      composition: {
        aspectRatio: "2:3",
        routePlacement: "center",
        titleBlock:
          "top. Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 16% of the poster width.",
        border: "",
        decorations: [],
      },
      route: { treatment: "line", color: "red", startMarker: "none", finishMarker: "none", shapeNotes: "" },
      geography: [],
      landmarks: [],
      text: { title: "Invented headline", subtitle: "", stats: [], rules: "Set the title as a large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 16% of the poster width. It is the largest text on the sheet. Wrap a long title instead of shrinking it below that size. Stats and map labels stay smaller. Do not add a title when the design has none." },
      grounding: { images: [], rules: [] },
      negative: [],
      finalPrompt: "x",
    },
    { ...input, title: "", subtitle: "" },
  );
  assert.equal((repaired.text as { title: string }).title, "");
  assert.equal((repaired.style as { typography: string }).typography, "Helvetica");
  assert.equal((repaired.composition as { titleBlock: string }).titleBlock, "top");
  assert.equal((repaired.text as { rules: string }).rules, "");
});

test("planner honors a supplied costume palette", () => {
  const messages = buildPlannerMessages(input);
  assert.match(String(messages[0].content), /Honor stylePreset.palette exactly: off-white, red/);
});
