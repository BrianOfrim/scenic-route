import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModifyPrompt, buildVariantPrompt, posterDesignHistory, MODIFY_SOURCE_RULE } from "./modifyPrompt";

const request = "Make the title larger and warm the paper.";

test("direct editing preserves the source and geometry and passes the request unchanged", () => {
  const prompt = buildModifyPrompt({ request, grounding: [{ role: "route-only" }, { role: "schematic" }, { role: "satellite" }] });
  assert.ok(prompt.startsWith(MODIFY_SOURCE_RULE));
  assert.match(prompt, /Image 2: route-only/);
  assert.match(prompt, /Image 3: schematic/);
  assert.match(prompt, /Image 4: satellite/);
  assert.match(prompt, /Do not add, omit, straighten or move route segments/);
  assert.match(prompt, /Do not invent place names/);
  assert.match(prompt, /8% of poster width/);
  assert.match(prompt, /If it has no title, do not add one unless requested/);
  assert.ok(prompt.endsWith(request));
});

test("editing advertises only attached grounding images and rejects empty requests", () => {
  const prompt = buildModifyPrompt({ request, grounding: [{ role: "schematic" }] });
  assert.match(prompt, /Image 2: schematic/);
  assert.doesNotMatch(prompt, /Image 3:/);
  assert.doesNotMatch(buildModifyPrompt({ request, grounding: [] }), /Image 2:/);
  assert.throws(() => buildModifyPrompt({ request: "  ", grounding: [] }), /modification request/);
});

test("variants preserve the grounding-only brief and apply edits in order without editing references", () => {
  const basePrompt = 'Image 1: schematic. Print "Fall ride". Use blue paper.';
  assert.equal(buildVariantPrompt({ basePrompt, editRequests: [] }), basePrompt);
  const prompt = buildVariantPrompt({ basePrompt, editRequests: [request, 'Use white paper and title "Winter ride".'] });
  assert.ok(prompt.startsWith(basePrompt));
  assert.ok(prompt.indexOf(request) < prompt.indexOf('Use white paper'));
  assert.match(prompt, /Later changes supersede earlier changes and the original brief/);
  assert.match(prompt, /exact route geometry and geographic fidelity remain mandatory/);
  assert.doesNotMatch(prompt, /current poster|Image 2/);
});

test("new records retain complete edit history without reading ancestors", async () => {
  const history = { basePrompt: "Original", editRequests: ["Warm paper", "Larger title"] };
  const restored = await posterDesignHistory({ posterId: "new", ...history, prompt: "Edit-only prompt" }, async () => {
    assert.fail("new records should not load ancestors");
  });
  assert.deepEqual(restored, history);
});

test("legacy edits recover the original brief and ordered requests", async () => {
  const records = {
    original: { posterId: "original", prompt: "Image 1: schematic. Original brief." },
    first: { posterId: "first", previousPosterId: "original", prompt: "Old chat rewrite", refineNotes: "Warm paper" },
  };
  const restored = await posterDesignHistory(
    { posterId: "second", previousPosterId: "first", prompt: "Another rewrite", refineNotes: "Larger title" },
    async id => records[id as keyof typeof records] ?? null,
  );
  assert.deepEqual(restored, { basePrompt: records.original.prompt, editRequests: ["Warm paper", "Larger title"] });
});

test("history handles deleted ancestors and cycles without duplicating requests", async () => {
  const orphan = { posterId: "orphan", previousPosterId: "deleted", prompt: "Saved brief", refineNotes: "Warm paper" };
  assert.deepEqual(await posterDesignHistory(orphan, async () => null), { basePrompt: "Saved brief", editRequests: [] });
  const cycle = { posterId: "cycle", previousPosterId: "cycle", prompt: "Saved brief", refineNotes: "Warm paper" };
  assert.deepEqual(await posterDesignHistory(cycle, async () => cycle), { basePrompt: "Saved brief", editRequests: [] });
});

test("refine, variant, then refine again retains history without accumulating edit prompts", async () => {
  const original = { posterId: "original", prompt: "Image 1: schematic. Blue paper." };
  const firstHistory = await posterDesignHistory(original, async () => null);
  firstHistory.editRequests.push("Use cream paper");
  const edited = {
    posterId: "edited",
    ...firstHistory,
    prompt: buildModifyPrompt({ request: "Use cream paper", grounding: [{ role: "schematic" }] }),
  };
  const variantHistory = await posterDesignHistory(edited, async () => null);
  const variant = { posterId: "variant", ...variantHistory, prompt: buildVariantPrompt(variantHistory) };
  const secondHistory = await posterDesignHistory(variant, async () => null);
  secondHistory.editRequests.push("Make the title larger");
  assert.deepEqual(secondHistory.editRequests, ["Use cream paper", "Make the title larger"]);
  assert.deepEqual(firstHistory.editRequests, ["Use cream paper"]);
  const prompt = buildVariantPrompt(secondHistory);
  assert.ok(prompt.startsWith(original.prompt));
  assert.equal(prompt.split("Use cream paper").length - 1, 1);
  assert.doesNotMatch(prompt, /current poster|Image 2:/);
});
