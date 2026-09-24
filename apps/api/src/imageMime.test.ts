import assert from "node:assert/strict";
import { test } from "node:test";
import { alignDataUrlMime, imageDataUrl, sniffImageMime } from "./imageMime";

const WEBP = Buffer.from("RIFF\x00\x00\x00\x00WEBP", "ascii");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("sniffImageMime reads webp and png magic bytes", () => {
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(Buffer.from("nope")), null);
});

test("alignDataUrlMime replaces a png label on webp bytes", () => {
  const declared = `data:image/png;base64,${WEBP.toString("base64")}`;
  assert.match(alignDataUrlMime(declared), /^data:image\/webp;base64,/);
  const png = `data:image/png;base64,${PNG.toString("base64")}`;
  assert.equal(alignDataUrlMime(png), png);
});

test("imageDataUrl declares the sniffed type", () => {
  assert.match(imageDataUrl(WEBP), /^data:image\/webp;base64,/);
  assert.match(imageDataUrl(Buffer.from("nope"), "image/png"), /^data:image\/png;base64,/);
});
