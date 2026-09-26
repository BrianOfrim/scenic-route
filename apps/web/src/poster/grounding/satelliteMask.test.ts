import assert from "node:assert/strict";
import test from "node:test";
import { queryFrameExpandM, queryFrameRing } from "../../../../api/src/osm/geoExtent";
import { satelliteReferenceMask } from "./satelliteMask";

const track: [number, number][] = [
  [43.63, -79.48],
  [43.64, -79.3],
  [43.63, -79.12],
];
const queryBbox: [[number, number], [number, number]] = [
  [-79.55, 43.58],
  [-79.05, 43.7],
];

test("the satellite mask is the query frame when geography is the whole map box", () => {
  const mask = satelliteReferenceMask({
    queryBbox,
    track,
    route: track,
    scope: "all",
  });
  const frame = queryFrameRing(
    [queryBbox[0][0], queryBbox[0][1], queryBbox[1][0], queryBbox[1][1]],
    queryFrameExpandM(track),
  );
  assert.deepEqual(mask, { clip: frame });
  assert.ok(frame.length >= 4);
});

test("a corridor mask is cut by the query frame", () => {
  const mask = satelliteReferenceMask({
    queryBbox,
    track,
    route: track,
    scope: "corridor",
    corridorM: 400,
  });
  assert.equal(mask?.whole, true);
  assert.ok(mask?.clip && mask.clip.length >= 4);
  assert.equal(typeof mask?.bandM, "number");
  if (typeof mask?.bandM !== "number") return;
  assert.ok(mask.bandM > 400);
});

test("a drawn ring is kept and still clipped to the query frame", () => {
  const ring: [number, number][] = [
    [-79.4, 43.6],
    [-79.2, 43.6],
    [-79.2, 43.66],
    [-79.4, 43.66],
  ];
  const mask = satelliteReferenceMask({
    queryBbox,
    track,
    route: track,
    scope: "ring",
    ring,
  });
  assert.equal(mask?.rings?.length, 1);
  assert.ok(mask?.clip && mask.clip.length >= 4);
  assert.notDeepEqual(mask?.rings?.[0], mask?.clip);
});
