import assert from "node:assert/strict";
import test from "node:test";
import { applyStatUnits, distanceToMeters, formatDistance, formatElevation, formatSpeed, statUnitsFrom } from "./statUnits";

test("edited distance converts between units without losing the stored precision", () => {
  assert.equal(distanceToMeters(10, "metric"), 10000);
  assert.equal(formatDistance(distanceToMeters(10, "metric"), "imperial"), "6.2 mi");
  assert.equal(distanceToMeters(10, "imperial"), 16093.44);
  assert.equal(formatDistance(distanceToMeters(10, "imperial"), "metric"), "16.1 km");
  assert.equal(distanceToMeters(0, "metric"), 0);
  assert.equal(distanceToMeters(-1, "metric"), null);
  assert.equal(distanceToMeters(NaN, "metric"), null);
});

test("stat units default to metric", () => {
  assert.equal(statUnitsFrom(undefined), "metric");
  assert.equal(statUnitsFrom("metric"), "metric");
  assert.equal(statUnitsFrom("imperial"), "imperial");
  assert.equal(statUnitsFrom("furlongs"), "metric");
});

test("distance, elevation, and speed switch between metric and imperial", () => {
  assert.equal(formatDistance(4200, "metric"), "4.2 km");
  assert.equal(formatDistance(4200, "imperial"), "2.6 mi");
  assert.equal(formatElevation(0, "metric"), "0 m");
  assert.equal(formatElevation(100, "imperial"), "328 ft");
  assert.equal(formatSpeed(1, "metric"), "3.6 km/h");
  assert.equal(formatSpeed(1, "imperial"), "2.2 mph");
  assert.equal(formatSpeed(0, "imperial"), "");
});

test("only distance, elevation, and speed are rewritten", () => {
  const stats = applyStatUnits(
    [
      { id: "date", label: "Date", value: "Sep 27, 2026" },
      { id: "distance", label: "Distance", value: "4.2 km" },
      { id: "movingTime", label: "Moving time", value: "1h 5m" },
      { id: "elevationGain", label: "Elevation gain", value: "0 m" },
      { id: "averageSpeed", label: "Average speed", value: "3.9 km/h" },
    ],
    { distance: 4200, elevationGain: 0, averageSpeed: 3.9 / 3.6 },
    "imperial",
  );
  assert.deepEqual(
    stats.map((item) => item.value),
    ["Sep 27, 2026", "2.6 mi", "1h 5m", "0 ft", "2.4 mph"],
  );
});
