import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURE_CATALOG, DEFAULT_FEATURE_IDS } from "../featureCatalog";
import { FEATURE_CATALOG as API_CATALOG } from "../../../../api/src/osm/catalog";
import { drawSchematicScene, schematicLayersFromFeatureIds } from "./renderSchematic";

test("geography catalogs agree and all geography is enabled for new posters", () => {
  const geography = FEATURE_CATALOG.filter((item) => item.group === "geography");
  assert.deepEqual(geography.map((item) => item.id), API_CATALOG.filter((item) => item.group === "geography").map((item) => item.id));
  for (const item of geography) assert.ok(DEFAULT_FEATURE_IDS.includes(item.id));
});

test("a route break starts a new stroke even after track sampling", () => {
  const moves: number[] = [];
  const ctx = new Proxy({}, {
    get: (_target, key) => key === "moveTo" ? (x: number) => { moves.push(x); } : () => {},
    set: () => true,
  }) as CanvasRenderingContext2D;
  const latlng = Array.from({ length: 2002 }, (_, i) => [0, i < 1001 ? i / 1000 : 10 + (i - 1001) / 1000] as [number, number]);
  drawSchematicScene(ctx, { latlng, routeBreaks: [1001], layers: { route: true, labels: false, routeMarkers: false } },
    (lng, lat) => [lng, lat], { width: 100, height: 100, northArrow: false });
  assert.deepEqual(moves, [0, 10]);
});

test("new land cover and shoreline layers render only while selected", () => {
  const ids = ["urban", "wetlands", "vegetation", "beaches", "coastline", "rock", "cliffs", "glaciers"];
  for (const id of ids) {
    const strokes = ["coastline", "cliffs"].includes(id);
    const points = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const ways = { [id]: { features: [{ geometry: strokes
      ? { type: "LineString" as const, coordinates: points }
      : { type: "Polygon" as const, coordinates: [points] } }] } };
    for (const enabled of [true, false]) {
      let paints = 0;
      const ctx = new Proxy({}, {
        get: (_target, key) => key === "fill" || key === "stroke" ? () => { paints++; } : () => {},
        set: () => true,
      }) as CanvasRenderingContext2D;
      drawSchematicScene(ctx, {
        latlng: [], ways,
        layers: { ...schematicLayersFromFeatureIds(enabled ? [id] : [], false), route: false, labels: false },
      }, (lng, lat) => [lng, lat], { width: 100, height: 100, northArrow: false });
      assert.equal(paints, enabled ? 1 : 0, `${id}: ${enabled}`);
    }
  }
});

test("a custom polygon clips background geography and leaves the route outside the clip", () => {
  const ways = {
    roads: { features: [{ geometry: { type: "LineString" as const, coordinates: [[0, 0], [2, 2]] } }] },
  };
  const layers = { ...schematicLayersFromFeatureIds(["major-roads"], false), labels: false };
  for (const points of [2, 3] as const) {
    let clips = 0;
    let clipped = false;
    let strokesWhileClipped = 0;
    let strokesAfterClip = 0;
    const ctx = new Proxy({}, {
      get: (_target, key) => {
        if (key === "clip") return () => { clips++; clipped = true; };
        if (key === "restore") return () => { clipped = false; };
        if (key === "stroke") return () => { if (clipped) strokesWhileClipped++; else strokesAfterClip++; };
        return () => {};
      },
      set: () => true,
    }) as CanvasRenderingContext2D;
    drawSchematicScene(ctx, {
      latlng: [[0, 0], [1, 1]],
      ways,
      layers,
      clipPolygon: (points === 3 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0], [1, 0]]) as [number, number][],
    }, (lng, lat) => [lng, lat], { width: 100, height: 100, northArrow: false });
    assert.equal(clips, points >= 3 ? 1 : 0);
    assert.equal(strokesWhileClipped, points >= 3 ? 1 : 0, "roads stay inside the clip");
    assert.ok(strokesAfterClip >= 1, "the route is drawn after the clip is lifted");
  }
});

test("retained lakes and rivers can each be hidden independently", () => {
  const ways = {
    water: { features: [{ geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] },
    riverAreas: { features: [{ geometry: { type: "Polygon" as const, coordinates: [[[1, 0], [2, 0], [2, 1], [1, 0]]] } }] },
    waterways: { features: [{ geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] } }] },
  };
  for (const ids of [[], ["lakes"], ["rivers"], ["lakes", "rivers"]]) {
    let fills = 0;
    let strokes = 0;
    const ctx = new Proxy({}, {
      get: (_target, key) => key === "fill" ? () => { fills++; } : key === "stroke" ? () => { strokes++; } : () => {},
      set: () => true,
    }) as CanvasRenderingContext2D;
    drawSchematicScene(ctx, {
      latlng: [], ways,
      layers: { ...schematicLayersFromFeatureIds(ids, false), labels: false },
    }, (lng, lat) => [lng, lat], { width: 100, height: 100 });
    assert.equal(fills, Number(ids.includes("lakes")) + Number(ids.includes("rivers")));
    assert.equal(strokes, ids.includes("rivers") ? 1 : 0);
  }
});

test("ocean paint is opaque over offshore park polygons", () => {
  const polygon = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const ways = {
    parks: { features: [{ geometry: polygon }] },
    ocean: { features: [{ geometry: polygon }] },
  };
  let fillStyle = "";
  const fills: string[] = [];
  const ctx = new Proxy({}, {
    get: (_target, key) => key === "fillStyle" ? fillStyle : key === "fill" ? () => { fills.push(fillStyle); } : () => {},
    set: (_target, key, value) => { if (key === "fillStyle") fillStyle = String(value); return true; },
  }) as CanvasRenderingContext2D;
  drawSchematicScene(ctx, {
    latlng: [], ways,
    layers: { ...schematicLayersFromFeatureIds(["parks", "coastline"], false), labels: false },
  }, (lng, lat) => [lng, lat], { width: 100, height: 100 });
  assert.equal(fills.length, 2);
  assert.match(fills[0], /^rgba\(/);
  assert.match(fills[1], /^#[0-9a-f]{6}$/i);
});
