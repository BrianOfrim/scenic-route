import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURE_CATALOG,
  nearRouteMForKind,
  parseFeatureSelection,
  resolveFeatures,
} from "./catalog";

test("landmark categories publish a default auto-add distance", () => {
  const landmarks = FEATURE_CATALOG.filter((item) => item.group === "landmarks");
  assert.ok(landmarks.length > 0);
  for (const item of landmarks) {
    assert.equal(typeof item.nearRouteM, "number", item.id);
    assert.ok((item.nearRouteM ?? 0) > 0, item.id);
  }
  assert.equal(FEATURE_CATALOG.find((item) => item.id === "towns")?.nearRouteM, 1000);
  assert.equal(FEATURE_CATALOG.find((item) => item.id === "named-water")?.nearRouteM, 500);
  assert.equal(FEATURE_CATALOG.find((item) => item.id === "peaks")?.nearRouteM, 100);
});

test("parseFeatureSelection reads optional metre overrides", () => {
  const parsed = parseFeatureSelection("lakes,peaks:250,towns:2000,food");
  assert.deepEqual(parsed.ids, ["lakes", "peaks", "towns", "food"]);
  assert.deepEqual(parsed.nearRouteM, { peaks: 250, towns: 2000 });
});

test("resolveFeatures applies corridor overrides", () => {
  const features = resolveFeatures(["peaks", "towns"], { peaks: 400, towns: 50 });
  assert.equal(features.find((item) => item.id === "peaks")?.nearRouteM, 400);
  assert.equal(features.find((item) => item.id === "towns")?.nearRouteM, 50);
});

test("nearRouteMForKind uses the selected category corridor", () => {
  const selected = resolveFeatures(["peaks", "towns", "named-water"], { peaks: 80, towns: 1500 });
  assert.equal(nearRouteMForKind("peak", selected), 80);
  assert.equal(nearRouteMForKind("village", selected), 1500);
  assert.equal(nearRouteMForKind("beach", selected), 500);
  assert.equal(nearRouteMForKind("cafe", selected), 100);
});
