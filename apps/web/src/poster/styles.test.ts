import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POSTER_STYLE, styleById, styleLabel } from "./styles";

test("styleById returns the matching preset", () => {
  assert.equal(styleById("tron").label, "Tron lightcycle");
  assert.equal(styleById("missing").id, DEFAULT_POSTER_STYLE.id);
});

test("styleLabel prefers the preset, then a fallback name", () => {
  assert.equal(styleLabel("swiss"), "Swiss minimal");
  assert.equal(styleLabel("made-up", "Ink wash"), "Ink wash");
  assert.equal(styleLabel(""), "Unknown theme");
});

test("style presets do not require mountains", () => {
  assert.doesNotMatch(styleById("middle-earth").prompt, /hachured mountains|purple haze mountains|stylized peaks/i);
  assert.doesNotMatch(styleById("synthwave").prompt, /mountain/i);
  assert.match(styleById("ukiyo-e").prompt, /peaks only if the geography includes them/i);
  assert.doesNotMatch(styleById("vintage-topo").prompt, /mountain/i);
});
