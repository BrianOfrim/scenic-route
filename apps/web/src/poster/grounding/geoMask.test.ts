import assert from "node:assert/strict";
import test from "node:test";
import { maskIsActive, projectorForFrame } from "./geoMask";

test("a fitted frame projects its corners to the canvas corners", () => {
  const project = projectorForFrame({
    width: 200,
    height: 100,
    nw: [-114, 54],
    se: [-113, 53],
  });
  const [x0, y0] = project(-114, 54);
  const [x1, y1] = project(-113, 53);
  assert.ok(Math.abs(x0) < 1e-6);
  assert.ok(Math.abs(y0) < 1e-6);
  assert.ok(Math.abs(x1 - 200) < 1e-6);
  assert.ok(Math.abs(y1 - 100) < 1e-6);
  const [midX] = project(-113.5, 53.5);
  assert.ok(midX > 90 && midX < 110);
});

test("a mask is active only when it keeps some region", () => {
  assert.equal(maskIsActive(null), false);
  assert.equal(maskIsActive({}), false);
  assert.equal(maskIsActive({ rings: [[[0, 0], [1, 0]]] }), false);
  assert.equal(maskIsActive({ rings: [[[0, 0], [1, 0], [1, 1]]] }), true);
  assert.equal(maskIsActive({ bandM: 800 }), true);
  assert.equal(maskIsActive({ bandM: [0, 400] }), true);
  assert.equal(maskIsActive({ whole: true }), false);
  assert.equal(maskIsActive({ lines: [[[0, 0], [1, 1]]], lineM: 80 }), true);
  assert.equal(maskIsActive({ lines: [[[0, 0], [1, 1]]] }), false);
  assert.equal(maskIsActive({ clip: [[0, 0], [1, 0], [1, 1]] }), true);
  assert.equal(maskIsActive({ clip: [[0, 0], [1, 0]] }), false);
});
