import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURE_CATALOG } from "./osm/catalog";
import { splitWays } from "./osm/features";
import { buildQuery, elementsToFeatures, unionQuery } from "./osm/overpass";

test("buildQuery injects bbox and header", () => {
  const q = buildQuery("(way[highway=primary]({{bbox}}););out geom;", [-113.2, 53.0, -113.0, 53.1]);
  assert.match(q, /\[out:json\]\[timeout:25\]\[bbox:/);
  assert.match(q, /53\.0000000,-113\.2000000,53\.1000000,-113\.0000000/);
});

test("unionQuery wraps selectors", () => {
  const q = unionQuery(['way[highway=primary]', "nwr[natural=water]"]);
  assert.match(q, /way\[highway=primary\]\(\{\{bbox\}\}\)/);
  assert.match(q, /out geom;/);
});

test("elementsToFeatures converts nodes, ways, and areas", () => {
  const features = elementsToFeatures([
    { type: "node", id: 1, lat: 53.1, lon: -113.1, tags: { name: "Cafe", amenity: "cafe" } },
    {
      type: "way",
      id: 2,
      tags: { highway: "primary" },
      geometry: [
        { lat: 53.0, lon: -113.0 },
        { lat: 53.01, lon: -113.01 },
      ],
    },
    {
      type: "way",
      id: 3,
      tags: { natural: "water" },
      geometry: [
        { lat: 53.0, lon: -113.0 },
        { lat: 53.0, lon: -112.99 },
        { lat: 53.01, lon: -112.99 },
        { lat: 53.0, lon: -113.0 },
      ],
    },
  ]);
  assert.equal(features.length, 3);
  assert.equal(features[0].geometry.type, "Point");
  assert.equal(features[1].geometry.type, "LineString");
  assert.equal(features[2].geometry.type, "Polygon");
  assert.equal(features[0].properties?.name, "Cafe");
});

test("splitWays buckets selected geography", () => {
  const geojson = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { tags: { highway: "primary" } },
        geometry: { type: "LineString" as const, coordinates: [[-113, 53], [-113.01, 53.01]] },
      },
      {
        type: "Feature" as const,
        properties: { tags: { highway: "residential" } },
        geometry: { type: "LineString" as const, coordinates: [[-113, 53], [-113.02, 53]] },
      },
      {
        type: "Feature" as const,
        properties: { tags: { natural: "water" } },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[[-113, 53], [-113.01, 53], [-113.01, 53.01], [-113, 53]]],
        },
      },
    ],
  };
  const selected = FEATURE_CATALOG.filter((item) => ["major-roads", "lakes"].includes(item.id));
  const ways = splitWays(geojson, selected);
  assert.equal(ways.roads.features.length, 1);
  assert.equal(ways.streets.features.length, 0);
  assert.equal(ways.water.features.length, 1);
});
