import assert from "node:assert/strict";
import { test } from "node:test";
import { assignTrailColors, nearestTrailName, routeVertexColors } from "./trailColors";

test("assignTrailColors cycles distinct named swatches", () => {
  const colored = assignTrailColors([{ name: "Porcupine Rim" }, { name: "Silverback" }]);
  assert.equal(colored[0].colorName, "teal");
  assert.equal(colored[1].colorName, "amber");
  assert.notEqual(colored[0].color, colored[1].color);
  assert.match(colored[0].color, /^#/);
});

test("assignTrailColors supports sixteen distinct swatches before wrapping", () => {
  const trails = Array.from({ length: 16 }, (_, i) => ({ name: `Trail ${i}` }));
  const colored = assignTrailColors(trails);
  const names = new Set(colored.map((trail) => trail.colorName));
  const hexes = new Set(colored.map((trail) => trail.color));
  assert.equal(names.size, 16);
  assert.equal(hexes.size, 16);
  assert.equal(colored[8].colorName, "yellow");
  assert.equal(colored[15].colorName, "plum");
  assert.equal(assignTrailColors([...trails, { name: "wrap" }])[16].colorName, "teal");
});

test("routeVertexColors paints only the GPS stretch that follows a trail", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.0],
    [53.002, -113.0],
    [53.003, -113.001],
  ];
  const colors = routeVertexColors(route, [
    {
      color: "#0f766e",
      geometry: {
        coordinates: [
          [
            [-113.0, 53.0],
            [-113.0, 53.001],
            [-113.0, 53.002],
          ],
        ],
      },
    },
  ]);
  assert.equal(colors[0], "#0f766e");
  assert.equal(colors[1], "#0f766e");
  assert.equal(colors[2], "#0f766e");
  assert.equal(colors[3], null);
});

test("routeVertexColors lets the first trail win overlaps", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.0],
  ];
  const line = {
    coordinates: [
      [
        [-113.0, 53.0],
        [-113.0, 53.001],
      ],
    ],
  };
  const colors = routeVertexColors(route, [
    { color: "#0f766e", geometry: line },
    { color: "#b45309", geometry: line },
  ]);
  assert.deepEqual(colors, ["#0f766e", "#0f766e"]);
});

test("routeVertexColors uses Strava indexes and ignores nearby off-span GPS", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.0],
    [53.002, -113.0],
    [53.003, -113.0],
  ];
  const colors = routeVertexColors(route, [
    {
      color: "#6d28d9",
      routeSpans: [{ start: 0, end: 1 }],
      geometry: {
        coordinates: [
          [
            [-113.0, 53.0],
            [-113.0, 53.001],
          ],
        ],
      },
    },
  ]);
  assert.equal(colors[0], "#6d28d9");
  assert.equal(colors[1], "#6d28d9");
  assert.equal(colors[2], null);
  assert.equal(colors[3], null);
});

test("routeVertexColors does not fall back to distance when spans are empty", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.0],
  ];
  const colors = routeVertexColors(route, [
    {
      color: "#6d28d9",
      routeSpans: [],
      geometry: {
        coordinates: [
          [
            [-113.0, 53.0],
            [-113.0, 53.001],
          ],
        ],
      },
    },
  ]);
  assert.deepEqual(colors, [null, null]);
});

test("nearestTrailName uses route spans when present", () => {
  const route: [number, number][] = [
    [53.0, -113.0],
    [53.001, -113.0],
    [53.002, -113.0],
  ];
  const trail = {
    name: "Mirror Lake Bridge Loop",
    routeSpans: [{ start: 0, end: 1 }],
    geometry: {
      coordinates: [
        [
          [-113.0, 53.0],
          [-113.0, 53.001],
        ],
      ],
    },
  };
  assert.equal(nearestTrailName([53.0, -113.0], [trail], undefined, route), "Mirror Lake Bridge Loop");
  assert.equal(nearestTrailName([53.002, -113.0], [trail], undefined, route), null);
});

test("nearestTrailName returns the first covering trail", () => {
  const line = {
    coordinates: [
      [
        [-113.0, 53.0],
        [-113.0, 53.001],
      ],
    ],
  };
  assert.equal(
    nearestTrailName(
      [53.0, -113.0],
      [
        { name: "Porcupine Rim", geometry: line },
        { name: "Silverback", geometry: line },
      ],
    ),
    "Porcupine Rim",
  );
  assert.equal(nearestTrailName([54.0, -114.0], [{ name: "Porcupine Rim", geometry: line }]), null);
});
