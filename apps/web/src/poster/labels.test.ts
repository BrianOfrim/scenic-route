import assert from "node:assert/strict";
import { test } from "node:test";
import { prioritizeLabels } from "./labels";

const poi = (name: string) => ({ name });

test("prioritizeLabels puts custom landmarks first and keeps every name", () => {
  const suggested = Array.from({ length: 20 }, (_, i) => poi(`Suggested ${i + 1}`));
  const custom = [poi("My Cafe"), poi("Trailhead")];
  const result = prioritizeLabels(suggested, custom);
  assert.equal(result.length, 22);
  assert.deepEqual(result.slice(0, 2).map((p) => p.name), ["My Cafe", "Trailhead"]);
  assert.equal(result[2].name, "Suggested 1");
});

test("prioritizeLabels dedupes names case-insensitively, custom entry wins", () => {
  const result = prioritizeLabels([poi("Norsemen Inn"), poi("Lake")], [poi("norsemen inn")]);
  assert.deepEqual(
    result.map((p) => p.name),
    ["norsemen inn", "Lake"],
  );
});
