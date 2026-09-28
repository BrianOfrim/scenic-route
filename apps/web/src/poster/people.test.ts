import assert from "node:assert/strict";
import test from "node:test";
import { formatPeople, parsePeople } from "./people";

test("parsePeople splits commas, lines, and, and ampersands", () => {
  assert.deepEqual(parsePeople("Alex, Jordan, Sam"), ["Alex", "Jordan", "Sam"]);
  assert.deepEqual(parsePeople("Alex\nJordan"), ["Alex", "Jordan"]);
  assert.deepEqual(parsePeople("Alex; Jordan & Sam"), ["Alex", "Jordan", "Sam"]);
  assert.deepEqual(parsePeople("Alex, Jordan and Sam"), ["Alex", "Jordan", "Sam"]);
  assert.deepEqual(parsePeople("Mary Ann, Chris"), ["Mary Ann", "Chris"]);
});

test("parsePeople drops blanks and duplicate spellings", () => {
  assert.deepEqual(parsePeople("  Alex, , alex, Jordan  "), ["Alex", "Jordan"]);
  assert.deepEqual(parsePeople(""), []);
  assert.deepEqual(parsePeople("   "), []);
});

test("formatPeople joins a credit line", () => {
  assert.equal(formatPeople([]), "");
  assert.equal(formatPeople(["Alex"]), "Alex");
  assert.equal(formatPeople(["Alex", "Jordan"]), "Alex and Jordan");
  assert.equal(formatPeople(["Alex", "Jordan", "Sam"]), "Alex, Jordan, and Sam");
});
