import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestPlaceName } from "./places";

test("nearestPlaceName picks the closest neighbourhood or town", () => {
  const name = nearestPlaceName(
    [
      { name: "Camrose", kind: "town", lat: 53.02, lng: -112.83 },
      { name: "Mirror Lake", kind: "water", lat: 53.021, lng: -112.831 },
    ],
    [{ name: "Parkridge", kind: "neighbourhood", lat: 53.01, lng: -112.82 }],
    [53.011, -112.821],
  );
  assert.equal(name, "Parkridge");
});

test("nearestPlaceName returns empty when nothing is a place", () => {
  assert.equal(
    nearestPlaceName([{ name: "Mirror Lake", kind: "water", lat: 53.02, lng: -112.83 }], [], [53.02, -112.83]),
    "",
  );
});
