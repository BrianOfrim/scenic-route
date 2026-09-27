import assert from "node:assert/strict";
import test from "node:test";
import { lngLatFromMercator, mercatorX, mercatorY, projectorForFrame } from "./geoMask";
import { cameraForFrame, fittedFrame, projectorForBbox } from "./mapFrame";

const bbox: [[number, number], [number, number]] = [
  [-79.55, 43.58],
  [-79.05, 43.7],
];

test("the fitted frame is the canvas, with the same margin on both axes", () => {
  const width = 1024;
  const height = 1365;
  const fitted = fittedFrame(bbox, width, height);
  const project = projectorForFrame({ width, height, nw: fitted.nw, se: fitted.se });
  const [x0, y0] = project(fitted.nw[0], fitted.nw[1]);
  const [x1, y1] = project(fitted.se[0], fitted.se[1]);
  assert.ok(Math.abs(x0) < 1e-6);
  assert.ok(Math.abs(y0) < 1e-6);
  assert.ok(Math.abs(x1 - width) < 1e-6);
  assert.ok(Math.abs(y1 - height) < 1e-6);

  const spanX = mercatorX(fitted.se[0]) - mercatorX(fitted.nw[0]);
  const spanY = mercatorY(fitted.se[1]) - mercatorY(fitted.nw[1]);
  assert.ok(Math.abs(spanX / spanY - width / height) < 1e-9);
});

test("a wide box keeps its longitude edges at the shared 3% margin", () => {
  const width = 100;
  const height = 200;
  const wide: [[number, number], [number, number]] = [
    [-10, -0.1],
    [10, 0.1],
  ];
  const project = projectorForBbox(wide, width, height);
  const inset = (0.03 / 1.06) * width;
  const [left] = project(-10, 0);
  const [right] = project(10, 0);
  assert.ok(Math.abs(left - inset) < 1e-6);
  assert.ok(Math.abs(right - (width - inset)) < 1e-6);
});

test("the satellite camera puts the same route vertex on the same pixel as the schematic", () => {
  const width = 1024;
  const height = 1365;
  const project = projectorForBbox(bbox, width, height);
  const fitted = fittedFrame(bbox, width, height);
  const camera = cameraForFrame({ width, height, nw: fitted.nw, se: fitted.se });
  const world = 512 * 2 ** camera.zoom;
  const centerX = mercatorX(camera.center[0]);
  const centerY = mercatorY(camera.center[1]);
  const samples: Array<[number, number]> = [
    [fitted.nw[0], fitted.nw[1]],
    [fitted.se[0], fitted.se[1]],
    [-79.3, 43.64],
    [-79.48, 43.61],
  ];
  for (const [lng, lat] of samples) {
    const [sx, sy] = project(lng, lat);
    const cx = (mercatorX(lng) - centerX) * world + width / 2;
    const cy = (mercatorY(lat) - centerY) * world + height / 2;
    assert.ok(Math.abs(sx - cx) < 1e-4, `x ${lng},${lat}: ${sx} vs ${cx}`);
    assert.ok(Math.abs(sy - cy) < 1e-4, `y ${lng},${lat}: ${sy} vs ${cy}`);
  }
});

test("mercator corners survive a trip through longitude and latitude", () => {
  const [lng, lat] = lngLatFromMercator(mercatorX(-79.3), mercatorY(43.65));
  assert.ok(Math.abs(lng + 79.3) < 1e-9);
  assert.ok(Math.abs(lat - 43.65) < 1e-9);
});
