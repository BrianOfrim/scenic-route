import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpenRouterError,
  extractMaxImages,
  extractMaxRefs,
  isImageModelId,
  isSchemaRejection,
  jsonResponseFormat,
  parseImageModels,
  parseImageResponse,
  imageModel,
  resolveImageModel,
} from "./openrouter";

test("jsonResponseFormat prefers strict json_schema when a schema is supplied", () => {
  assert.deepEqual(jsonResponseFormat("poster_spec", { type: "object" }), {
    type: "json_schema",
    json_schema: { name: "poster_spec", strict: true, schema: { type: "object" } },
  });
  assert.deepEqual(jsonResponseFormat(undefined, undefined), { type: "json_object" });
});

test("isSchemaRejection only matches structured-output complaints", () => {
  assert.equal(isSchemaRejection(400, { error: { message: "response_format json_schema is not supported" } }), true);
  assert.equal(isSchemaRejection(400, { error: { message: "Invalid schema for response_format" } }), true);
  assert.equal(isSchemaRejection(400, { error: { message: "context length exceeded" } }), false);
  assert.equal(isSchemaRejection(401, { error: { message: "json_schema" } }), false);
  assert.equal(isSchemaRejection(500, { error: { message: "json_schema" } }), false);
});

test("parseImageResponse reads every image and cost", () => {
  const parsed = parseImageResponse({
    data: [
      { b64_json: "aaaa", media_type: "image/png" },
      { b64_json: "bbbb", media_type: "image/jpeg" },
    ],
    usage: { cost: 0.16 },
  });
  assert.deepEqual(
    parsed.images.map((item) => ({ b64: item.b64, mediaType: item.mediaType })),
    [
      { b64: "aaaa", mediaType: "image/png" },
      { b64: "bbbb", mediaType: "image/jpeg" },
    ],
  );
  assert.equal(parsed.cost, 0.16);
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

test("extractMaxImages reads n from endpoints", () => {
  assert.equal(
    extractMaxImages({
      data: { endpoints: [{ supported_parameters: { n: { type: "range", min: 1, max: 10 } } }] },
    }),
    10,
  );
  assert.equal(extractMaxImages({ data: { endpoints: [{ supported_parameters: { n: { max: 1 } } }] } }), 1);
  assert.equal(extractMaxImages({}), null);
});

test("parseImageModels reads discovery listing", () => {
  const models = parseImageModels({
    data: [
      { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", supported_parameters: {} },
      {
        id: "openai/gpt-image-2",
        name: "GPT Image 2",
        supported_parameters: { n: { type: "range", min: 1, max: 10 }, input_references: { max: 16 } },
      },
      { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", supported_parameters: { input_references: { max: 8 } } },
      { id: "not-a-model", name: "Skip" },
    ],
  });
  assert.deepEqual(
    models.map((item) => ({ id: item.id, maxReferences: item.maxReferences, maxImages: item.maxImages })),
    [
      { id: "black-forest-labs/flux.2-pro", maxReferences: 8, maxImages: 1 },
      { id: "google/gemini-2.5-flash-image", maxReferences: 3, maxImages: 1 },
      { id: "openai/gpt-image-2", maxReferences: 16, maxImages: 10 },
    ],
  );
});

test("resolveImageModel accepts OpenRouter slugs", () => {
  assert.equal(isImageModelId("google/gemini-2.5-flash-image"), true);
  assert.equal(isImageModelId("openai/gpt-5-image:free"), true);
  assert.equal(isImageModelId("not-a-model"), false);
  assert.equal(resolveImageModel("google/gemini-3-pro-image-preview"), "google/gemini-3-pro-image-preview");
  const previous = process.env.OPENROUTER_IMAGE_MODEL;
  process.env.OPENROUTER_IMAGE_MODEL = "openai/gpt-image-test";
  try {
    assert.equal(resolveImageModel("nope"), "openai/gpt-image-test");
    assert.equal(resolveImageModel(""), "openai/gpt-image-test");
  } finally {
    if (previous == null) delete process.env.OPENROUTER_IMAGE_MODEL;
    else process.env.OPENROUTER_IMAGE_MODEL = previous;
  }
});

test("imageModel requires OPENROUTER_IMAGE_MODEL", () => {
  const previous = process.env.OPENROUTER_IMAGE_MODEL;
  delete process.env.OPENROUTER_IMAGE_MODEL;
  try {
    assert.throws(() => imageModel(), OpenRouterError);
  } finally {
    if (previous == null) delete process.env.OPENROUTER_IMAGE_MODEL;
    else process.env.OPENROUTER_IMAGE_MODEL = previous;
  }
});
