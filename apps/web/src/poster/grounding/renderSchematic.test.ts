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

test("new land cover and shoreline layers render only while selected", () => {
  const ids = ["wetlands", "vegetation", "beaches", "coastline", "rock", "cliffs", "glaciers"];
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
