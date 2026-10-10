import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { annotatedPoster, validateEditAnnotation } from "./refinementAnnotation";

test("annotations require bounded normalized coordinates and limit input size", () => {
  assert.deepEqual(validateEditAnnotation(undefined), []);
  assert.deepEqual(validateEditAnnotation([[{ x: 0, y: 0 }, { x: 1, y: 1 }]]), [[{ x: 0, y: 0 }, { x: 1, y: 1 }]]);
  for (const value of [null, "svg", [[{ x: 0, y: 0 }]], [[{ x: NaN, y: 0 }, { x: 1, y: 1 }]], [[{ x: -1, y: 0 }, { x: 1, y: 1 }]], Array(33).fill([{ x: 0, y: 0 }, { x: 1, y: 1 }]), [Array(2049).fill({ x: 0.5, y: 0.5 })]]) {
    assert.throws(() => validateEditAnnotation(value), /Invalid edit annotation/);
  }
});

test("annotated copies preserve image size and draw magenta at source coordinates without changing the original", async () => {
  const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#000000" } }).png().toBuffer();
  const original = Buffer.from(source);
  const result = await annotatedPoster(source, [[{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }]]);
  const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 200);
  assert.equal(info.height, 100);
  const center = (50 * info.width + 100) * info.channels;
  assert.deepEqual([...data.subarray(center, center + 3)], [255, 0, 184]);
  assert.deepEqual([...data.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual(source, original);
});
