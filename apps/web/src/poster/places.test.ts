import assert from "node:assert/strict";
import { test } from "node:test";
import { cropCoordinates, nearestPlaceName, shareEndpointPlace } from "./places";

test("coordinates follow the selected crop midpoint and show hemispheres", () => {
  const track: [number, number][] = [[49.8, -97.1], [49.9, -97.2], [-33.5, 151.2]];
  assert.equal(cropCoordinates(track, 0, 2), "49.9000° N, 97.2000° W");
  assert.equal(cropCoordinates(track, 2, 2), "33.5000° S, 151.2000° E");
  assert.equal(cropCoordinates([], 0, 1), "");
});

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

test("shared endpoint field handles matching names, blank labels, and explicit choices", () => {
  assert.equal(shareEndpointPlace(" Winnipeg ", "winnipeg", false), true);
  assert.equal(shareEndpointPlace("", "", false), true);
  assert.equal(shareEndpointPlace("Banff", "Lake Louise", false), false);
  assert.equal(shareEndpointPlace("Banff", "", false), false);
  assert.equal(shareEndpointPlace("", "", true), true);
  assert.equal(shareEndpointPlace("", "", true, false), false);
  assert.equal(shareEndpointPlace("Banff", "Lake Louise", false, true), true);
});
