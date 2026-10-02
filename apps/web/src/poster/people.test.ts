import assert from "node:assert/strict";
import test from "node:test";
import { defaultPeopleForUser, formatPeople, parsePeople } from "./people";

test("default people uses the account name and falls back to the email prefix", () => {
  assert.equal(defaultPeopleForUser({ name: "  Brian   Smith ", email: "different@example.com" }), "Brian Smith");
  assert.equal(defaultPeopleForUser({ name: "", email: "brian.smith+rides@example.com" }), "Brian Smith");
  assert.equal(defaultPeopleForUser({ email: "brian@example.com" }), "Brian");
  assert.equal(defaultPeopleForUser({ name: "brian@example.com", email: "brian@example.com" }), "Brian");
  assert.equal(defaultPeopleForUser({ name: "A".repeat(60), email: "brian@example.com" }).length, 40);
});

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

test("disabled people are excluded while preserving the editable draft", () => {
  assert.deepEqual(parsePeople("Brian, Alex", false), []);
  assert.deepEqual(parsePeople("Brian, Alex", true), ["Brian", "Alex"]);
});

test("formatPeople joins a credit line", () => {
  assert.equal(formatPeople([]), "");
  assert.equal(formatPeople(["Alex"]), "Alex");
  assert.equal(formatPeople(["Alex", "Jordan"]), "Alex and Jordan");
  assert.equal(formatPeople(["Alex", "Jordan", "Sam"]), "Alex, Jordan, and Sam");
});
