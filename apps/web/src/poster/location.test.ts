import assert from "node:assert/strict";
import test from "node:test";
import { locationCaption, locationInput } from "./location";

test("suggested and saved locations use commas in the input and dots on the poster", () => {
  const saved = "Edmonton · Alberta · Canada";
  assert.equal(locationInput(saved), "Edmonton, Alberta, Canada");
  assert.equal(locationCaption(locationInput(saved)), saved);
  assert.equal(locationCaption(saved), saved);
});

test("input preserves incomplete edits while the caption omits empty parts", () => {
  const draft = " Edmonton, Alberta, ";
  assert.equal(locationInput(draft), draft);
  assert.equal(locationCaption(draft), "Edmonton · Alberta");
  assert.equal(locationCaption(" , · "), "");
});

test("location punctuation and partial place names remain intact", () => {
  assert.equal(locationCaption("St. John's, Newfoundland and Labrador, Canada"), "St. John's · Newfoundland and Labrador · Canada");
  assert.equal(locationCaption("Canada"), "Canada");
  assert.equal(locationCaption(""), "");
});
