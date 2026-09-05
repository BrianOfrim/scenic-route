import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlannerMessages } from "./planner";

test("buildPlannerMessages includes landmarks and grounding roles", () => {
  const messages = buildPlannerMessages({
    activity: { name: "Lunch ride", sportType: "Ride", isLoop: true },
    title: "Lunch ride",
    subtitle: "12.4 km · 41 min",
    stats: [{ label: "Distance", value: "12.4 km" }],
    style: {
      id: "swiss",
      label: "Swiss minimal",
      prompt: "Swiss modernist map poster",
      palette: ["off-white", "red"],
      typography: "Helvetica",
    },
    customStylePrompt: "more negative space",
    aspectRatio: "2:3",
    geography: [{ id: "lakes", label: "Lakes & ponds" }],
    pois: [
      {
        name: "Norsemen Inn",
        kind: "pub",
        lat: 53.02,
        lng: -112.83,
        distToRouteM: 40,
        routeFrac: 0.12,
        bearing: "west",
        xy: { x: 0.2, y: 0.3, region: "upper-left" },
      },
    ],
    grounding: [{ index: 1, role: "schematic", legend: "red = route" }],
  });
  assert.equal(messages.length, 2);
  assert.match(String(messages[0].content), /geographic source of truth/);
  const user = JSON.parse(String(messages[1].content)) as {
    landmarks: Array<{ name: string; placement: string }>;
    customStylePrompt: string;
    groundingImages: Array<{ role: string }>;
  };
  assert.equal(user.landmarks[0].name, "Norsemen Inn");
  assert.match(user.landmarks[0].placement, /upper-left/);
  assert.equal(user.customStylePrompt, "more negative space");
  assert.equal(user.groundingImages[0].role, "schematic");
});
