import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { POSTER_STYLES, paletteChoices } from "./styles";
import { THEME_EXAMPLES, examplesForTheme, type ThemeExample } from "./themeExampleCatalog";

const sample = (styleId: string, paletteId: string): ThemeExample => ({
  styleId, paletteId, thumbnail: `/samples/${styleId}-${paletteId}-thumb.webp`, image: `/samples/${styleId}-${paletteId}.webp`,
});

test("theme browsing orders the default first and filters redundant Auto and invalid samples", () => {
  const samples = [sample("swiss", "black"), sample("blueprint", "auto"), sample("swiss", "auto"), sample("swiss", "invalid"), sample("swiss", "red")];
  assert.deepEqual(examplesForTheme("swiss", samples).map((s) => s.paletteId), ["red", "black"]);
  assert.deepEqual(examplesForTheme("custom", [sample("custom", "auto")]), []);
  assert.deepEqual(examplesForTheme("unknown", [sample("unknown", "auto")]), []);
  assert.deepEqual(examplesForTheme("risograph", [sample("risograph", "auto"), sample("risograph", "purple-sunflower"), sample("risograph", "pink-teal")]).map((s) => s.paletteId), ["pink-teal", "purple-sunflower"]);
  assert.deepEqual(examplesForTheme("art-deco", [sample("art-deco", "luxury-line"), sample("art-deco", "black-gold")]).map((s) => s.paletteId), ["black-gold", "luxury-line"]);
});

test("the installed collection covers every available theme and palette with valid WebP files", () => {
  for (const style of POSTER_STYLES.filter((s) => s.id !== "custom")) {
    const examples = examplesForTheme(style.id);
    assert.deepEqual(examples.map((s) => s.paletteId), paletteChoices(style).map((p) => p.id), style.id);
  }
  const seen = new Set<string>();
  for (const example of THEME_EXAMPLES) {
    const key = `${example.styleId}/${example.paletteId}`;
    assert.ok(!seen.has(key), `Duplicate ${key}`);
    seen.add(key);
    assert.deepEqual(Object.keys(example).sort(), ["image", "paletteId", "styleId", "thumbnail"]);
    for (const url of [example.image, example.thumbnail]) {
      assert.match(url, /^\/theme-examples\/beltline\/[a-z0-9-]+\.webp$/);
      const bytes = fs.readFileSync(new URL(`../../public${url}`, import.meta.url));
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    }
  }
});
