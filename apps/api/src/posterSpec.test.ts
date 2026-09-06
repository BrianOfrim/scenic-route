import assert from "node:assert/strict";
import { test } from "node:test";
import { specToImagePrompt, validatePosterSpec } from "./posterSpec";

const sample = {
  style: {
    name: "Swiss minimal",
    medium: "print poster",
    palette: ["off-white", "red"],
    typography: "Helvetica",
    texture: "paper",
    references: "",
  },
  composition: {
    aspectRatio: "2:3",
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
    shapeNotes: "north-south loop",
  },
  geography: [{ kind: "water", name: "lake", placement: "left", treatment: "flat blue" }],
  landmarks: [{ name: "Castle Mountain", kind: "peak", placement: "upper-right", icon: "peak" }],
  text: {
    title: "Bow Valley",
    subtitle: "Sep 5, 2026 · 42.0 km",
    stats: [{ label: "Distance", value: "42.0 km" }],
    rules: "exact spelling",
  },
  grounding: {
    images: [{ index: 1, role: "schematic", legend: "red = route" }],
    rules: ["do not invent geography"],
  },
  negative: ["photorealism"],
  finalPrompt: "Swiss modernist map poster of a red loop.",
};

test("validatePosterSpec accepts a complete spec", () => {
  const spec = validatePosterSpec(sample);
  assert.equal(spec.text.title, "Bow Valley");
  assert.equal(spec.landmarks[0].name, "Castle Mountain");
  assert.equal(spec.landmarks[0].pin, 1);
});

test("validatePosterSpec fills a missing finalPrompt", () => {
  const spec = validatePosterSpec({ ...sample, finalPrompt: "" });
  assert.match(spec.finalPrompt, /1 "Castle Mountain"/);
  assert.match(spec.finalPrompt, /Write each name on the map/);
  assert.match(spec.finalPrompt, /Bow Valley/);
  assert.match(spec.finalPrompt, /Start marker: green dot/);
  assert.match(spec.finalPrompt, /Finish marker: black dot/);
});

test("validatePosterSpec fallback uses one marker when start and finish match", () => {
  const spec = validatePosterSpec({
    ...sample,
    route: { ...sample.route, startMarker: "combined gold/green disc", finishMarker: "combined gold/green disc" },
    finalPrompt: "",
  });
  assert.match(spec.finalPrompt, /Marker: combined gold\/green disc/);
});

test("validatePosterSpec rejects a missing title", () => {
  assert.throws(
    () => validatePosterSpec({ ...sample, text: { ...sample.text, title: "" }, finalPrompt: "x" }),
    /title/,
  );
});

test("validatePosterSpec fallback never emits blank fragments", () => {
  const spec = validatePosterSpec({
    ...sample,
    style: { ...sample.style, name: "", medium: "", palette: [] },
    route: { ...sample.route, treatment: "", color: "" },
    text: { ...sample.text, subtitle: "" },
    finalPrompt: "",
  });
  assert.doesNotMatch(spec.finalPrompt, /Palette: \./);
  assert.doesNotMatch(spec.finalPrompt, /Route:\s+in\s+\./);
  assert.doesNotMatch(spec.finalPrompt, /Subtitle exactly ""/);
  assert.match(spec.finalPrompt, /Create a stylized map poster/);
});

test("specToImagePrompt renders prose without JSON or empty fields", () => {
  const spec = validatePosterSpec({
    ...sample,
    style: { ...sample.style, references: "", texture: "" },
    composition: { ...sample.composition, decorations: [], border: "" },
    grounding: { images: [], rules: [] },
  });
  const prompt = specToImagePrompt(spec);
  assert.doesNotMatch(prompt, /SPEC \(JSON\)/);
  assert.doesNotMatch(prompt, /[{}\[\]]/);
  assert.doesNotMatch(prompt, /References:|Texture:|Border:|Decorations:|Reference images:/);
  assert.match(prompt, /Style: Swiss minimal\./);
  assert.match(prompt, /Palette: off-white, red\./);
  assert.match(prompt, /Route: single accent line, in red\./);
  assert.match(prompt, /Start marker: green dot\. Finish marker: black dot\./);
  assert.match(prompt, /1 "Castle Mountain" \(upper-right; icon: peak\)/);
  assert.match(prompt, /private location index/);
  assert.match(prompt, /Do not draw the numbers/);
  assert.match(prompt, /Do not add a legend, key, or numbered callouts/);
  assert.match(prompt, /replace every disc with the written name/);
  assert.match(prompt, /Title, exactly: "Bow Valley"\./);
  assert.match(prompt, /Stats to typeset: Distance 42\.0 km\./);
});

test("specToImagePrompt appends explicit exclusions once", () => {
  const prompt = specToImagePrompt(validatePosterSpec({ ...sample, negative: ["photorealism", "no watermark"] }));
  assert.match(prompt, /Avoid: photorealism; no watermark; no legend strip or color key;/);
  assert.equal(prompt.match(/no watermark/g)?.length, 1);
  assert.match(prompt, /no number-to-name legend or index/);
  assert.match(prompt, /no numbered landmark discs, pin numbers, or numbered callouts/);
  assert.match(prompt, /no text other than the title block and the listed landmark names/);
});

test("specToImagePrompt drops planner copy that treats numbers as artwork", () => {
  const prompt = specToImagePrompt(
    validatePosterSpec({
      ...sample,
      finalPrompt:
        "Middle-earth map. Numbered sepia discs mark landmarks. Lower cartouche for the title.",
      grounding: {
        images: [{ index: 1, role: "schematic", legend: "red = route" }],
        rules: ["Landmarks are represented solely by numbered circular discs matching their pin index."],
      },
      negative: ["printed landmark text labels", "photorealism"],
    }),
  );
  assert.doesNotMatch(prompt, /Numbered sepia discs mark landmarks/);
  assert.doesNotMatch(prompt, /represented solely by numbered/);
  assert.doesNotMatch(prompt, /printed landmark text labels/);
  assert.match(prompt, /Lower cartouche for the title/);
  assert.match(prompt, /Write each name once/);
});
