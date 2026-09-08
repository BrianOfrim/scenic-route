import assert from "node:assert/strict";
import { test } from "node:test";
import { areaLetter, assignAreaLetters } from "./areaLetters";

test("assignAreaLetters stamps A, B, C in order", () => {
  const labeled = assignAreaLetters([{ name: "Augustana" }, { name: "Jubilee Park" }]);
  assert.equal(labeled[0].letter, "A");
  assert.equal(labeled[1].letter, "B");
  assert.equal(areaLetter(0), "A");
});
