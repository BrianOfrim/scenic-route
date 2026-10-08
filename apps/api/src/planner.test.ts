import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInitialPoster, normalizeVibes, planPoster, type PlannerInput } from "./planner";
import { MARKER_PLACEMENT_RULE, specToImagePrompt, validatePosterSpec } from "./posterSpec";
import { resolveImagePrompt } from "./poster";

const input: PlannerInput = {
  activity: { isLoop: true }, routeMarkers: { enabled: true, mode: "loop" },
  title: "Lunch ride", subtitle: "12.4 km", stats: [{ label: "Distance", value: "12.4 km" }],
  style: { id: "risograph", label: "Risograph", prompt: "Two-ink print. Keep misregistration in the background.", palette: ["orange", "teal"], typography: "zine sans" },
  aspectRatio: "3:4", geography: [{ id: "lakes", label: "Lakes & ponds" }], pois: [],
  grounding: [
    { index: 1, role: "route-only", legend: "exact track" },
    { index: 2, role: "schematic", legend: "geographic layout" },
    { index: 3, role: "satellite", legend: "land cover" },
  ],
};
const prompt = (changes: Partial<PlannerInput> = {}) => buildInitialPoster({ ...input, ...changes }).spec.finalPrompt;

test("initial preparation is deterministic, leaves input untouched, and requires no chat model or fetch", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network request"); });
  const old = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  try {
    const original = structuredClone(input);
    const a = buildInitialPoster(input);
    assert.deepEqual(a, await planPoster("owner", input));
    assert.deepEqual(a, buildInitialPoster(input));
    assert.deepEqual(input, original);
    assert.equal(a.cost, 0);
    assert.equal(a.model, undefined);
    assert.equal(a.spec.promptTemplateVersion, 1);
  } finally { if (old !== undefined) process.env.OPENROUTER_MODEL = old; }
});

test("fixed palette delegates color allocation and layout without inventing choices", () => {
  const p = prompt();
  assert.match(p, /Use only these palette inks: orange, teal/);
  assert.match(p, /Tints and the paper showing through are allowed/);
  assert.match(p, /do not introduce additional ink colors/);
  assert.match(p, /Choose one palette ink for maximum route contrast first/);
  assert.match(p, /visibly thicker and higher-contrast than every background/);
  assert.match(p, /Forest and water must also use this palette/);
  assert.match(p, /unused space or a separate band/);
  assert.doesNotMatch(p, /Title placement:|Border:|Decorations:/);
  assert.match(p, /Geometry and exact-text constraints take priority/);
});

test("open palettes and custom styles delegate color selection and preserve instructions once", () => {
  for (const style of [{ ...input.style, openPalette: true }, { id: "custom", label: "Custom", prompt: "Ink etched on silver", palette: [] }]) {
    const p = prompt({ style, customStylePrompt: style.prompt });
    assert.match(p, /Choose a coherent palette/);
    assert.doesNotMatch(p, /Use only these palette inks/);
    assert.equal(p.split(style.prompt).length - 1, 1);
  }
  const p = prompt({ customStylePrompt: "Use a playful letterform", vibes: "Windy\n and wavy!" });
  assert.equal(p.split(input.style.prompt).length - 1, 1);
  assert.equal(p.split("zine sans").length - 1, 1);
  assert.equal(p.split("Use a playful letterform").length - 1, 1);
  assert.equal(p.split("Windy and wavy!").length - 1, 1);
  assert.match(p, /visual appearance only; never print it/);
  assert.equal(normalizeVibes("a".repeat(600)).length, 500);
});

test("marker modes preserve count and names while delegating appearance", () => {
  assert.match(prompt(), /Marker: one combined start\/finish symbol/);
  assert.equal(prompt().split(MARKER_PLACEMENT_RULE).length - 1, 1);
  assert.doesNotMatch(prompt(), /Start marker:|Finish marker:/);
  const off = prompt({ routeMarkers: { enabled: false, mode: "loop", startName: "Hidden endpoint" } });
  assert.match(off, /Draw no endpoint markers/);
  assert.doesNotMatch(off, /Hidden endpoint/);
  const separate = prompt({ routeMarkers: { enabled: true, mode: "start-finish", startName: "Home", finishName: "Park" } });
  assert.match(separate, /Start marker: start symbol/);
  assert.match(separate, /Finish marker: distinct finish symbol/);
  assert.match(separate, /Write "Home" at the start marker and "Park" at the finish marker/);
});

test("exact text, people and location credits stay authoritative and print once", () => {
  const p = prompt({ people: ["Alex", "Sam"], stats: [...input.stats, { label: "Location", value: "Edmonton · Alberta" }] });
  assert.equal(p.split('"12.4 km"').length - 1, 1);
  assert.match(p, /Print each of these text items once: "Lunch ride"; "12.4 km"/);
  assert.match(p, /"With Alex and Sam"/);
  assert.match(p, /These are people, not places/);
  assert.match(p, /Location caption, exactly: "Edmonton · Alberta"/);
  assert.match(p, /font size at least 8%/);
});

test("references retain order and geometry constraints but never URLs or image bytes", () => {
  const p = prompt({ grounding: input.grounding.map(ref => ({ ...ref, url: "https://private.example/secret", dataUrl: "data:image/png;base64,SECRET" })) });
  assert.ok(p.indexOf("Image 1: route-only") < p.indexOf("Image 2: schematic"));
  assert.ok(p.indexOf("Image 2: schematic") < p.indexOf("Image 3: satellite"));
  assert.match(p, /Image 1 defines the exact route geometry/);
  assert.match(p, /Draw that route exactly once/);
  assert.match(p, /Preserve every segment, bend, crossing, out-and-back and gap/);
  assert.match(p, /Background roads, bridges and shorelines must never become route segments/);
  assert.match(p, /Preserve every supplied shape and position/);
  assert.doesNotMatch(p, /SECRET|private.example/);
});

test("new setup ignores cached planner decisions and annotation fields", () => {
  const previousSpec = buildInitialPoster(input).spec;
  previousSpec.style.references = "OLD STYLE";
  const p = prompt({ previousSpec, refineNotes: "OLD PLANNING NOTES", pois: [{ name: "OLD LANDMARK" } as any] });
  assert.doesNotMatch(p, /OLD STYLE|OLD PLANNING NOTES|OLD LANDMARK/);
});

test("versioned prompts survive validation and explicit edit prompts take precedence", () => {
  const spec = buildInitialPoster(input).spec;
  const roundtrip = validatePosterSpec(JSON.parse(JSON.stringify(spec)));
  assert.equal(roundtrip.promptTemplateVersion, 1);
  assert.equal(specToImagePrompt(roundtrip), spec.finalPrompt);
  assert.equal(resolveImagePrompt(roundtrip), spec.finalPrompt);
  assert.equal(resolveImagePrompt(roundtrip).split(MARKER_PLACEMENT_RULE).length - 1, 1);
  assert.ok(resolveImagePrompt(roundtrip, "Apply this edit").endsWith("Apply this edit"));
  const legacy = { ...roundtrip, promptTemplateVersion: undefined, finalPrompt: "LEGACY UNUSED LEAD", route: { ...roundtrip.route, color: "red" } };
  assert.doesNotMatch(specToImagePrompt(legacy), /LEGACY UNUSED LEAD/);
  assert.match(specToImagePrompt(legacy), /Draw the route in red/);
});

test("invalid preparation fails early and hosted reference URLs require a batch", async () => {
  assert.throws(() => prompt({ grounding: [] }), /grounding image/);
  assert.throws(() => prompt({ grounding: [{ index: 2, role: "schematic", legend: "" }] }), /ordered image/);
  assert.throws(() => prompt({ style: { ...input.style, prompt: " " } }), /style description/);
  await assert.rejects(planPoster("owner", { ...input, grounding: [{ index: 1, role: "schematic", legend: "", url: "https://untrusted.example" }] }), /batch id/);
});


test("template aspect ratio uses the same normalization as image generation", () => {
  const { spec } = buildInitialPoster({ ...input, aspectRatio: "4:5" });
  assert.equal(spec.composition.aspectRatio, "3:4");
  assert.match(spec.finalPrompt, /Aspect ratio: 3:4/);
});
