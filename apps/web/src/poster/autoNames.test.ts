import assert from "node:assert/strict";
import { test } from "node:test";
import { addedFeatureIds, forgetDismissedForLayers, takeFreshNames } from "./autoNames";

test("takeFreshNames adds incoming names the user has not dismissed", () => {
  const dismissed = new Set<string>();
  assert.deepEqual(takeFreshNames([], ["Lions Creative Playground"], dismissed), ["Lions Creative Playground"]);
});

test("takeFreshNames keeps a name out after the user dismisses it", () => {
  const dismissed = new Set(["Lions Creative Playground"]);
  assert.deepEqual(takeFreshNames([], ["Lions Creative Playground"], dismissed), []);
});

test("takeFreshNames still adds a name that only appeared in a previous query", () => {
  const dismissed = new Set<string>();
  assert.deepEqual(
    takeFreshNames([], ["Lions Creative Playground"], dismissed),
    ["Lions Creative Playground"],
  );
});

test("forgetDismissedForLayers re-offers names when that layer is turned on", () => {
  const dismissed = new Set(["Lions Creative Playground", "Camrose"]);
  forgetDismissedForLayers(
    dismissed,
    [
      { name: "Lions Creative Playground", kind: "playground" },
      { name: "Camrose", kind: "town" },
    ],
    ["playgrounds"],
  );
  assert.equal(dismissed.has("Lions Creative Playground"), false);
  assert.equal(dismissed.has("Camrose"), true);
  assert.deepEqual(takeFreshNames([], ["Lions Creative Playground", "Camrose"], dismissed), [
    "Lions Creative Playground",
  ]);
});

test("addedFeatureIds ignores the first load and reports newly enabled layers", () => {
  assert.deepEqual(addedFeatureIds(null, ["parks", "playgrounds"]), []);
  assert.deepEqual(addedFeatureIds(["parks"], ["parks", "playgrounds"]), ["playgrounds"]);
});
