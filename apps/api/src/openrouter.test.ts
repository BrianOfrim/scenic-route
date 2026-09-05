import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_IMAGE_MODEL,
  extractMaxRefs,
  isImageModelId,
  parseImageModels,
  parseImageResponse,
  resolveImageModel,
} from "./openrouter";

test("parseImageResponse reads b64 and cost", () => {
  const parsed = parseImageResponse({
    data: [{ b64_json: "aaaa", media_type: "image/png" }],
    usage: { cost: 0.04 },
  });
  assert.equal(parsed.b64, "aaaa");
  assert.equal(parsed.cost, 0.04);
});

test("extractMaxRefs reads endpoint metadata", () => {
  assert.equal(
    extractMaxRefs({
      data: { endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] },
    }),
    3,
  );
  assert.equal(extractMaxRefs({ data: { max_input_references: 4 } }), 4);
  assert.equal(extractMaxRefs({}), null);
});

test("parseImageModels reads discovery listing", () => {
  const models = parseImageModels({
    data: [
      { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", supported_parameters: {} },
      { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", supported_parameters: { input_references: { max: 8 } } },
      { id: "not-a-model", name: "Skip" },
    ],
  });
  assert.deepEqual(
    models.map((item) => ({ id: item.id, maxReferences: item.maxReferences })),
    [
      { id: "black-forest-labs/flux.2-pro", maxReferences: 8 },
      { id: "google/gemini-2.5-flash-image", maxReferences: 3 },
    ],
  );
});

test("resolveImageModel accepts OpenRouter slugs", () => {
  assert.equal(isImageModelId("google/gemini-2.5-flash-image"), true);
  assert.equal(isImageModelId("openai/gpt-5-image:free"), true);
  assert.equal(isImageModelId("not-a-model"), false);
  assert.equal(resolveImageModel("google/gemini-3-pro-image-preview"), "google/gemini-3-pro-image-preview");
  assert.equal(resolveImageModel("nope"), process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL);
});
