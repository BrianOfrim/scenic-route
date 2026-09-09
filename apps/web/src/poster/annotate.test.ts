import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTrailAlias,
  nearestRouteHit,
  nextTrailAliases,
  orderedSpan,
  schematicXY,
  trailSourceName,
  userLandmark,
  userNamedWay,
} from "./annotate";

const northSouth: [number, number][] = [
  [53.0, -113.0],
  [53.01, -113.0],
  [53.02, -113.0],
  [53.03, -113.0],
];

const bbox: [[number, number], [number, number]] = [
  [-113.05, 52.98],
  [-112.95, 53.05],
];

test("nearestRouteHit snaps to the closest vertex of the nearest segment", () => {
  const hit = nearestRouteHit([53.019, -113.001], northSouth);
  assert.equal(hit.index, 2);
  assert.ok(hit.distM < 120);
  assert.ok(hit.routeFrac > 0.4 && hit.routeFrac < 0.8);
});

test("userLandmark keeps the clicked coordinates and marks the source as user", () => {
  const poi = userLandmark("Grandma's mailbox", 53.015, -112.99, northSouth, bbox);
  assert.ok(poi);
  assert.equal(poi.name, "Grandma's mailbox");
  assert.equal(poi.kind, "landmark");
  assert.equal(poi.source, "user");
  assert.equal(poi.lat, 53.015);
  assert.equal(poi.lng, -112.99);
  assert.ok(poi.distToRouteM > 0);
  assert.match(poi.xy.region, /left|center|right/);
});

test("userLandmark rejects a blank name", () => {
  assert.equal(userLandmark("   ", 53, -113, northSouth, bbox), null);
});

test("userNamedWay slices the GPS stretch and stores full-track spans", () => {
  const way = userNamedWay("The steep bit", 1, 3, northSouth, bbox);
  assert.ok(way);
  assert.equal(way.name, "The steep bit");
  assert.equal(way.source, "user");
  assert.deepEqual(way.routeSpans, [{ start: 1, end: 3 }]);
  assert.equal(way.geometry.coordinates[0].length, 3);
  assert.deepEqual(way.geometry.coordinates[0][0], [-113.0, 53.01]);
  assert.equal(way.distToRouteM, 0);
});

test("userNamedWay orders flipped clicks and needs at least two points", () => {
  const way = userNamedWay("Out and back", 3, 1, northSouth, bbox);
  assert.ok(way);
  assert.deepEqual(way.routeSpans, [{ start: 1, end: 3 }]);
  assert.equal(userNamedWay("Same point", 2, 2, northSouth, bbox)?.routeSpans?.[0].end, 3);
  assert.equal(userNamedWay("Empty", 0, 1, [], bbox), null);
});

test("trail aliases keep the original name as identity", () => {
  const first = nextTrailAliases("Mirror Lake Bridge Loop", "Lakeside path", {}, [
    "Mirror Lake Bridge Loop",
    "College Hill",
  ]);
  assert.ok("aliases" in first);
  assert.equal(first.display, "Lakeside path");
  assert.equal(trailSourceName("Lakeside path", first.aliases), "Mirror Lake Bridge Loop");
  assert.equal(applyTrailAlias({ name: "Mirror Lake Bridge Loop" }, first.aliases).name, "Lakeside path");

  const again = nextTrailAliases("Lakeside path", "Shore hug", first.aliases, ["Lakeside path", "College Hill"]);
  assert.ok("aliases" in again);
  assert.deepEqual(again.aliases, { "Mirror Lake Bridge Loop": "Shore hug" });

  const revert = nextTrailAliases("Shore hug", "Mirror Lake Bridge Loop", again.aliases, [
    "Shore hug",
    "College Hill",
  ]);
  assert.ok("aliases" in revert);
  assert.deepEqual(revert.aliases, {});
  assert.equal(revert.display, "Mirror Lake Bridge Loop");
});

test("trail aliases reject a blank or colliding name", () => {
  assert.deepEqual(nextTrailAliases("A", "   ", {}, ["A"]), { error: "Name this stretch" });
  assert.deepEqual(nextTrailAliases("A", "College Hill", {}, ["A", "College Hill"]), {
    error: "“College Hill” is already a named stretch",
  });
});

test("orderedSpan and schematicXY stay stable", () => {
  assert.deepEqual(orderedSpan(8, 2), { start: 2, end: 8 });
  const nw = schematicXY(53.04, -113.04, bbox);
  assert.equal(nw.region, "upper-left");
});
