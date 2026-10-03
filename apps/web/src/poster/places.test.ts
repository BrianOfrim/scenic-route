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

test("shared endpoint fields depend on geographic proximity", () => {
  assert.equal(shareEndpointPlace([[49.9, -97.1], [49.9, -97.1]]), true);
  assert.equal(shareEndpointPlace([[49.9, -97.1], [49.901, -97.1]]), true);
  assert.equal(shareEndpointPlace([[49.9, -97.1], [49.902, -97.1]]), false);
  assert.equal(shareEndpointPlace([[49.9, -97.1], [50, -97.1]]), false);
  assert.equal(shareEndpointPlace([]), false);
  assert.equal(shareEndpointPlace([[49.9, -97.1]]), false);
});

test("long routes still require geographically close endpoints", () => {
  assert.equal(shareEndpointPlace([[49.9, -97.1], [51, -97.1], [49.91, -97.1]]), false);
});

test("explicit shared endpoint choices override the geographic default", () => {
  assert.equal(shareEndpointPlace([[49.9, -97.1], [49.901, -97.1]], false), false);
  assert.equal(shareEndpointPlace([[49.9, -97.1], [50, -97.1]], true), true);
});
