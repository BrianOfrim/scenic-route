import assert from "node:assert/strict";
import { test } from "node:test";
import { assertUsableSpec, buildPlannerMessages, repairPlannerOutput, type PlannerInput } from "./planner";
import { validatePosterSpec } from "./posterSpec";

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
  assert.match(String(messages[0].content), /optional finalPrompt/);
  assert.match(String(messages[0].content), /combined start\/finish marker/);
  assert.match(String(messages[0].content), /never a prose string in place of an object/);
  assert.match(String(messages[0].content), /"landmarks":\[\{"name":""/);
  const user = JSON.parse(String(messages[1].content)) as {
    landmarks: Array<Record<string, unknown>>;
    customStylePrompt: string;
    groundingImages: Array<{ role: string }>;
    routeMarkers: { enabled: boolean; mode: string };
  };
  assert.equal(user.landmarks[0].name, "Norsemen Inn");
  assert.equal(user.landmarks[0].placement, "upper-left, west of the route");
  assert.equal(user.landmarks[0].proximity, "on the route");
  assert.equal(user.landmarks[0].routeProgressPct, 12);
  assert.equal("lat" in user.landmarks[0], false, "planner payload should not carry coordinates");
  assert.equal(user.customStylePrompt, "more negative space");
  assert.equal(user.groundingImages[0].role, "schematic");
  assert.deepEqual(user.routeMarkers, { enabled: true, mode: "loop" });
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
  assert.equal(spec.style.typography, "Helvetica");
  assert.equal(spec.composition.routePlacement, "route centered, title at the bottom");
  assert.equal(spec.composition.aspectRatio, "2:3");
  assert.equal(spec.route.treatment, "thick red line with a gold loop marker");
  assert.deepEqual(
    spec.geography.map((item) => item.treatment),
    ["flat blue lakes", "pale grey roads"],
  );
  assert.deepEqual(
    spec.landmarks.map((item) => [item.name, item.placement]),
    [
      ["Norsemen Inn", "pub, upper-left"],
      ["Camrose", "center"],
    ],
  );
  assert.equal(spec.text.title, "Lunch ride");
  assert.equal(spec.text.subtitle, "12.4 km · 41 min");
  assert.deepEqual(spec.text.stats, [{ label: "Distance", value: "12.4 km" }]);
  assert.equal(spec.text.rules, "exact spelling only");
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

test("assertUsableSpec rejects a spec with no style or route direction", () => {
  const empty = validatePosterSpec({ text: { title: "x" }, finalPrompt: "y" });
  assert.throws(() => assertUsableSpec(empty), /unusable spec/);
});
