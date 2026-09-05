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
});

test("validatePosterSpec fills a missing finalPrompt", () => {
  const spec = validatePosterSpec({ ...sample, finalPrompt: "" });
  assert.match(spec.finalPrompt, /Castle Mountain/);
  assert.match(spec.finalPrompt, /Bow Valley/);
});

test("validatePosterSpec rejects a missing title", () => {
  assert.throws(
    () => validatePosterSpec({ ...sample, text: { ...sample.text, title: "" }, finalPrompt: "x" }),
    /title/,
  );
});

test("specToImagePrompt embeds JSON", () => {
  const prompt = specToImagePrompt(validatePosterSpec(sample));
  assert.match(prompt, /SPEC \(JSON\)/);
  assert.match(prompt, /"name": "Swiss minimal"/);
});
