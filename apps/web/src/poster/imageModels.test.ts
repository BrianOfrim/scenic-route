import assert from "node:assert/strict";
import { test } from "node:test";
import { minMaxReferences, shortModelLabel, uniqueIds } from "./imageModels";

test("shortModelLabel prefers a distinct display name", () => {
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image", "Gemini 2.5 Flash Image"), "Gemini 2.5 Flash Image");
  assert.equal(shortModelLabel("google/gemini-2.5-flash-image"), "gemini-2.5-flash-image");
  assert.equal(shortModelLabel("local-model", "local-model"), "local-model");
  assert.equal(shortModelLabel(""), "Unknown model");
});

test("uniqueIds drops blanks and duplicates", () => {
  assert.deepEqual(uniqueIds([" a ", "a", "", "b"]), ["a", "b"]);
});

test("minMaxReferences uses the most restrictive selected model", () => {
  const models = [
    { id: "one", maxReferences: 8 },
    { id: "two", maxReferences: 3 },
  ];
  assert.equal(minMaxReferences(["one", "two"], models), 3);
  assert.equal(minMaxReferences(["one"], models), 8);
  assert.equal(minMaxReferences([], models), 3);
});
