import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodePosterThumb, POSTER_THUMB_MAX_PX } from "./thumb";

test("encodePosterThumb writes a WebP no larger than the card long edge", async () => {
  const png = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: { r: 51, g: 68, b: 85 } },
  })
    .png()
    .toBuffer();
  const thumb = await encodePosterThumb(png);
  const info = await sharp(thumb).metadata();
  assert.equal(info.format, "webp");
  assert.ok((info.width ?? 0) <= POSTER_THUMB_MAX_PX);
  assert.ok((info.height ?? 0) <= POSTER_THUMB_MAX_PX);
  assert.equal(info.height, POSTER_THUMB_MAX_PX);
  assert.ok(thumb.byteLength < png.byteLength);
});
