import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURE_CATALOG } from "./osm/catalog";
import {
  annotatePoisInsideAreas,
  asAreaGeometry,
  classifyPoi,
  collectNamedAreas,
  collectNamedWays,
  dropPoiNames,
  mergeNamedWays,
  namedWaysFromSegmentEfforts,
  pruneNestedAreas,
  rankPois,
  splitWays,
  type NamedArea,
} from "./osm/features";
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
  assert.match(unionQuery(["way[highway=path][name]"], "center"), /out center;/);
});

test("catalog puts neighbourhoods, campuses, and named parks in named-areas", () => {
  for (const id of ["neighbourhoods", "colleges", "named-parks"]) {
    const item = FEATURE_CATALOG.find((feature) => feature.id === id);
    assert.ok(item);
    assert.equal(item.bucket, "named-areas");
  }
  const schools = FEATURE_CATALOG.find((item) => item.id === "schools");
  assert.equal(schools?.bucket, "poi");
});

test("catalog includes named trail selectors", () => {
  assert.equal(FEATURE_CATALOG.some((item) => item.id === "named-trails"), false);
  const strava = FEATURE_CATALOG.find((item) => item.id === "strava-segments");
  assert.ok(strava);
  assert.equal(strava.label, "Named trails");
  assert.equal(strava.bucket, "strava-ways");
  assert.deepEqual(strava.selectors, []);
});

test("collectNamedWays merges same-name segments into a labeled line", () => {
  const geojson = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [-109.5, 38.6],
            [-109.45, 38.59],
          ],
        },
      },
      {
        type: "Feature" as const,
        properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [-109.41, 38.581],
            [-109.4, 38.58],
          ],
        },
      },
    ],
  };
  const route: [number, number][] = [
    [38.58, -109.4],
    [38.581, -109.401],
  ];
  const trails = collectNamedWays(geojson, route, [-109.5, 38.57, -109.39, 38.61]);
  assert.equal(trails.length, 1);
  assert.equal(trails[0].name, "Porcupine Rim");
  assert.equal(trails[0].kind, "trail");
  assert.equal(trails[0].geometry.type, "MultiLineString");
  assert.equal(trails[0].geometry.coordinates.length, 2);
  assert.ok(trails[0].distToRouteM < 200);
});

test("mergeNamedWays keeps the closer copy of a trail", () => {
  const a = collectNamedWays(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
          geometry: { type: "LineString", coordinates: [[-109.3994, 38.5804], [-109.4004, 38.5814]] },
        },
      ],
    },
    [
      [38.58, -109.4],
      [38.581, -109.401],
    ],
    [-109.5, 38.57, -109.39, 38.61],
  );
  const b = collectNamedWays(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
          geometry: { type: "LineString", coordinates: [[-109.4, 38.58], [-109.401, 38.581]] },
        },
      ],
    },
    [
      [38.58, -109.4],
      [38.581, -109.401],
    ],
    [-109.5, 38.57, -109.39, 38.61],
  );
  const merged = mergeNamedWays(a, b);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].distToRouteM <= Math.min(a[0].distToRouteM, b[0].distToRouteM));
});

test("namedWaysFromSegmentEfforts slices the GPS track into labeled lines", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.001],
    [53.002, -113.002],
    [53.003, -113.003],
    [53.004, -113.004],
  ];
  const trails = namedWaysFromSegmentEfforts(
    [
      { name: "Sprint", hidden: false, distance: 80, start_index: 0, end_index: 1 },
      { name: "Hidden Climb", hidden: true, distance: 400, start_index: 0, end_index: 3 },
      {
        name: "ignored",
        hidden: false,
        distance: 900,
        start_index: 1,
        end_index: 4,
        segment: { name: "Silverback" },
      },
    ],
    route,
    [-113.01, 52.99, -112.99, 53.01],
  );
  assert.equal(trails.length, 1);
  assert.equal(trails[0].name, "Silverback");
  assert.equal(trails[0].source, "strava");
  assert.equal(trails[0].kind, "trail");
  assert.equal(trails[0].geometry.coordinates[0].length, 4);
  assert.deepEqual(trails[0].routeSpans, [{ start: 1, end: 4 }]);
});

test("mergeNamedWays prefers OpenStreetMap geometry over a Strava slice", () => {
  const route: [number, number][] = [
    [38.58, -109.4],
    [38.581, -109.401],
  ];
  const bbox: [number, number, number, number] = [-109.5, 38.57, -109.39, 38.61];
  const osm = collectNamedWays(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Silverback", tags: { highway: "path", name: "Silverback" } },
          geometry: { type: "LineString", coordinates: [[-109.4, 38.58], [-109.4008, 38.5808]] },
        },
      ],
    },
    route,
    bbox,
  );
  const strava = namedWaysFromSegmentEfforts(
    [{ name: "Silverback", distance: 400, start_index: 0, end_index: 1 }],
    route,
    bbox,
  );
  const merged = mergeNamedWays(osm, strava);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "osm");
  assert.deepEqual(merged[0].routeSpans, [{ start: 0, end: 1 }]);
});

test("classifyPoi treats named paths and mtb routes as trails", () => {
  assert.equal(classifyPoi({ highway: "path", name: "Porcupine Rim" }), "trail");
  assert.equal(classifyPoi({ route: "mtb", name: "Whistler All Mountain" }), "trail");
  assert.equal(classifyPoi({ natural: "peak", name: "Hawk Hill" }), "peak");
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

test("elementsToFeatures flattens route relation members", () => {
  const features = elementsToFeatures([
    {
      type: "relation",
      id: 9,
      tags: { name: "North Shore", route: "mtb", type: "route" },
      members: [
        {
          type: "way",
          ref: 1,
          geometry: [
            { lat: 49.3, lon: -123.1 },
            { lat: 49.31, lon: -123.11 },
          ],
        },
        {
          type: "way",
          ref: 2,
          geometry: [
            { lat: 49.31, lon: -123.11 },
            { lat: 49.32, lon: -123.12 },
          ],
        },
      ],
    },
  ]);
  assert.equal(features.length, 1);
  assert.equal(features[0].geometry.type, "MultiLineString");
  assert.equal(features[0].properties?.name, "North Shore");
  assert.equal(features[0].properties?.tags.route, "mtb");
});

test("rankPois keeps the closest segment of a named trail", () => {
  const geojson = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
        geometry: { type: "Point" as const, coordinates: [-109.5, 38.6] },
      },
      {
        type: "Feature" as const,
        properties: { name: "Porcupine Rim", tags: { highway: "path", name: "Porcupine Rim" } },
        geometry: { type: "Point" as const, coordinates: [-109.4, 38.58] },
      },
    ],
  };
  const route: [number, number][] = [
    [38.58, -109.4],
    [38.581, -109.401],
  ];
  const pois = rankPois(geojson, route, [-109.5, 38.57, -109.39, 38.61], FEATURE_CATALOG);
  assert.equal(pois.length, 1);
  assert.equal(pois[0].kind, "trail");
  assert.ok(pois[0].distToRouteM < 200);
});

test("rankPois keeps only landmarks you ride past or through", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.005, -113.0],
    [53.01, -113.0],
  ];
  const bbox: [number, number, number, number] = [-113.06, 52.99, -112.94, 53.02];
  const geojson = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { name: "Norsemen Inn", tags: { amenity: "pub", name: "Norsemen Inn" } },
        geometry: { type: "Point" as const, coordinates: [-113.0, 53.0007] },
      },
      {
        type: "Feature" as const,
        properties: { name: "Castle Mountain", tags: { natural: "peak", name: "Castle Mountain" } },
        geometry: { type: "Point" as const, coordinates: [-112.97, 53.005] },
      },
      squarePoly("Camrose", { place: "town" }, -112.985, 53.005, 0.02),
    ],
  };
  const pois = rankPois(geojson, route, bbox, FEATURE_CATALOG);
  assert.deepEqual(
    pois.map((poi) => poi.name).sort(),
    ["Camrose", "Norsemen Inn"],
  );
  assert.equal(pois.find((poi) => poi.name === "Camrose")?.distToRouteM, 0);
  assert.ok((pois.find((poi) => poi.name === "Norsemen Inn")?.distToRouteM ?? 999) < 100);
});

test("collectNamedWays drops trails the ride does not pass", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.005, -113.0],
    [53.01, -113.0],
  ];
  const bbox: [number, number, number, number] = [-113.04, 52.99, -112.96, 53.02];
  const trails = collectNamedWays(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "On Route Trail", tags: { highway: "path", name: "On Route Trail" } },
          geometry: { type: "LineString", coordinates: [[-113.0, 53.005], [-113.0002, 53.006]] },
        },
        {
          type: "Feature",
          properties: { name: "Far Trail", tags: { highway: "path", name: "Far Trail" } },
          geometry: { type: "LineString", coordinates: [[-112.97, 53.0], [-112.97, 53.01]] },
        },
      ],
    },
    route,
    bbox,
  );
  assert.deepEqual(
    trails.map((trail) => trail.name),
    ["On Route Trail"],
  );
});

test("collectNamedAreas drops districts the ride does not enter or pass", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.005, -113.0],
    [53.01, -113.0],
  ];
  const bbox: [number, number, number, number] = [-113.06, 52.98, -112.94, 53.03];
  const { areas } = collectNamedAreas(
    {
      type: "FeatureCollection",
      features: [
        squarePoly("Old Strathcona", { place: "neighbourhood" }, -113.0, 53.005, 0.004),
        squarePoly("Far Quarter", { place: "neighbourhood" }, -112.97, 53.005, 0.003),
      ],
    },
    route,
    bbox,
  );
  assert.deepEqual(
    areas.map((area) => area.name),
    ["Old Strathcona"],
  );
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

function squarePoly(
  name: string,
  tags: Record<string, string>,
  lng: number,
  lat: number,
  half: number,
) {
  return {
    type: "Feature" as const,
    properties: { name, tags: { ...tags, name } },
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
      ]],
    },
  };
}

function areaFixture(name: string, kind: string, lng: number, lat: number, half: number): NamedArea {
  return {
    name,
    kind,
    geometry: squarePoly(name, {}, lng, lat, half).geometry,
    lat,
    lng,
    distToRouteM: 20,
    routeFrac: 0.4,
    bearing: "west",
    xy: { x: 0.4, y: 0.5, region: "middle-center" },
  };
}

test("collectNamedAreas keeps on-route polygons and falls back when OSM has only a point", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.005, -113.0],
    [53.01, -113.0],
  ];
  const bbox: [number, number, number, number] = [-113.04, 52.98, -112.96, 53.03];
  const { areas, fallbacks } = collectNamedAreas(
    {
      type: "FeatureCollection",
      features: [
        squarePoly("Old Strathcona", { place: "neighbourhood" }, -113.0, 53.005, 0.004),
        {
          type: "Feature",
          properties: { name: "Garneau", tags: { place: "neighbourhood", name: "Garneau" } },
          geometry: { type: "Point", coordinates: [-113.0, 53.004] },
        },
        squarePoly("Alberta", { place: "neighbourhood" }, -113.0, 53.005, 0.2),
      ],
    },
    route,
    bbox,
  );
  assert.equal(areas.length, 1);
  assert.equal(areas[0].name, "Old Strathcona");
  assert.equal(areas[0].kind, "neighbourhood");
  assert.equal(areas[0].geometry.type, "Polygon");
  assert.ok(areas[0].distToRouteM < 50);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].properties?.name, "Garneau");
});

test("asAreaGeometry joins closed relation members into a polygon", () => {
  const geometry = asAreaGeometry({
    type: "MultiLineString",
    coordinates: [
      [
        [-113.01, 53.0],
        [-112.99, 53.0],
      ],
      [
        [-112.99, 53.0],
        [-112.99, 53.02],
        [-113.01, 53.02],
        [-113.01, 53.0],
      ],
    ],
  });
  assert.equal(geometry?.type, "Polygon");
  assert.ok(geometry && geometry.coordinates[0].length >= 4);
});

test("pruneNestedAreas prefers an on-route campus over its neighbourhood", () => {
  const neighbourhood = areaFixture("University Area", "neighbourhood", -113.0, 53.005, 0.01);
  const campus = { ...areaFixture("Augustana", "university", -113.0, 53.005, 0.002), distToRouteM: 10 };
  const kept = pruneNestedAreas([neighbourhood, campus]);
  assert.deepEqual(
    kept.map((item) => item.name),
    ["Augustana"],
  );
});

test("annotatePoisInsideAreas and dropPoiNames keep hierarchy out of the pin list", () => {
  const campus = areaFixture("Augustana", "university", -113.0, 53.005, 0.004);
  const pois = [
    {
      name: "Augustana",
      kind: "university",
      lat: 53.005,
      lng: -113.0,
      distToRouteM: 10,
      routeFrac: 0.4,
      bearing: "west",
      xy: { x: 0.4, y: 0.5, region: "middle-center" },
    },
    {
      name: "Remedy Cafe",
      kind: "cafe",
      lat: 53.005,
      lng: -113.0,
      distToRouteM: 15,
      routeFrac: 0.41,
      bearing: "west",
      xy: { x: 0.41, y: 0.5, region: "middle-center" },
    },
  ];
  const annotated = annotatePoisInsideAreas(dropPoiNames(pois, [campus]), [campus]);
  assert.equal(annotated.length, 1);
  assert.equal(annotated[0].name, "Remedy Cafe");
  assert.equal(annotated[0].inside, "Augustana");
});

test("annotatePoisInsideAreas does not put a city inside a park", () => {
  const park = areaFixture("Rudy Swanson Recreation Park", "park", -113.0, 53.005, 0.004);
  const city = {
    name: "Camrose",
    kind: "city",
    lat: 53.005,
    lng: -113.0,
    distToRouteM: 80,
    routeFrac: 0.2,
    bearing: "west",
    xy: { x: 0.4, y: 0.5, region: "middle-center" },
  };
  const annotated = annotatePoisInsideAreas([city], [park]);
  assert.equal(annotated[0].inside, undefined);
});
