import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canChangeThemeSelections,
  AUTO_PALETTE_ID,
  DEFAULT_POSTER_STYLE,
  POSTER_STYLES,
  TITLE_PHONE_CLAUSE,
  isCostumeStyle,
  normalizePaletteId,
  paletteIdsForStyle,
  paletteChoices,
  defaultPaletteId,
  parsePlanSlotKey,
  planSlotKey,
  planSlotLabel,
  resolveStyleColor,
  showsPalettePicker,
  specForSlot,
  styleById,
  styleLabel,
  stylePlanSlots,
} from "./styles";

const IDENTITY_HUES: Record<string, RegExp> = {
  "middle-earth": /tea-stain|sepia|red dotted/i,
  "vintage-topo": /tan and sage|bold red/i,
  blueprint: /cyan paper|white technical/i,
};

const COSTUME_CLICHE: Record<string, RegExp> = {
  swiss: /\bred\b/i,
  wpa: /poster-orange|forest-green/i,
  watercolour: /wash-blue|sap-green/i,
  "art-deco": /gold and teal|\bgold\b|\bteal\b/i,
  rpg: /nes-green|nes-blue|nes-tan/i,
  risograph: /fluorescent pink|\bteal\b/i,
  "linen-postcard": /chrome-teal|bumper-red|chrome bumper/i,
  "art-nouveau": /gold-green|muted-rose/i,
  bauhaus: /\bred\b|\byellow\b|\bblue\b/i,
  modernist: /\bmustard\b|\bterracotta\b|\bturquoise\b|\bolive\b/i,
};

test("preset typography leaves title sizing to the shared prompt", () => {
  assert.match(TITLE_PHONE_CLAUSE, /8% of the poster width/);
  assert.match(TITLE_PHONE_CLAUSE, /not a zoomed crop/);
  for (const style of POSTER_STYLES) {
    if (style.id === "custom") {
      assert.equal(style.typography, "");
      continue;
    }
    assert.ok(style.typography.trim(), style.id);
    assert.doesNotMatch(style.typography, /8%|clearly readable when the whole poster/, style.id);
  }
});

test("default poster selection is WPA park with the Park palette", () => {
  assert.equal(DEFAULT_POSTER_STYLE.id, "wpa");
  assert.equal(DEFAULT_POSTER_STYLE.label, "WPA park");
  assert.deepEqual(stylePlanSlots([DEFAULT_POSTER_STYLE.id]), [{
    key: "wpa::park", styleId: "wpa", paletteId: "park",
  }]);
});

test("retired themes are not available as new-poster styles", () => {
  for (const id of ["linocut", "transit", "flat", "star-chart", "psychedelic", "neobrutalism", "minimalist"]) {
    assert.equal(POSTER_STYLES.some((style) => style.id === id), false, id);
  }
});

test("styleById returns the matching preset", () => {
  assert.equal(styleById("blueprint").label, "Blueprint");
  assert.equal(styleById("linen-postcard").label, "Linen postcard");
  assert.equal(styleById("art-nouveau").label, "Art nouveau");
  assert.equal(styleById("bauhaus").label, "Bauhaus");
  assert.equal(styleById("modernist").label, "Modernist");
  assert.equal(styleById("minimalist").id, DEFAULT_POSTER_STYLE.id);
  assert.equal(styleById("missing").id, DEFAULT_POSTER_STYLE.id);
});

test("styleLabel prefers the preset, then a fallback name", () => {
  assert.equal(styleLabel("swiss"), "Minimal");
  assert.equal(styleLabel("minimalist"), "Minimalist");
  assert.equal(styleLabel("made-up", "Ink wash"), "Ink wash");
  assert.equal(styleLabel(""), "Unknown theme");
});

test("style presets style supplied stats and do not demand a date, distance, or duration line", () => {
  for (const style of POSTER_STYLES) {
    assert.doesNotMatch(style.prompt, /set the date, distance, and duration/i, style.id);
    assert.doesNotMatch(style.typography, /\bmetadata\b/i, style.id);
  }
  assert.match(styleById("swiss").prompt, /If none were supplied, set no stats line/);
  assert.match(styleById("swiss").prompt, /Do not add a date, distance, duration/);
});

test("style presets do not require mountains", () => {
  assert.doesNotMatch(styleById("middle-earth").prompt, /hachured mountains|purple haze mountains|stylized peaks/i);
  assert.doesNotMatch(styleById("vintage-topo").prompt, /mountain/i);
  assert.doesNotMatch(styleById("linen-postcard").prompt, /mountain|peak/i);
  assert.doesNotMatch(styleById("art-nouveau").prompt, /mountain|peak/i);
});

test("identity prompts still name their hues", () => {
  for (const [id, hue] of Object.entries(IDENTITY_HUES)) {
    assert.match(styleById(id).prompt, hue, id);
    assert.equal(styleById(id).colorMode, "identity", id);
    assert.equal(showsPalettePicker(styleById(id)), false, id);
  }
  assert.equal(styleById("custom").colorMode, "identity");
});

test("costume base prompts do not name costume hues", () => {
  for (const [id, cliche] of Object.entries(COSTUME_CLICHE)) {
    const style = styleById(id);
    assert.ok(isCostumeStyle(style), id);
    assert.doesNotMatch(style.prompt, cliche, id);
  }
});

test("Swiss prompt locks the GPT-inspired type hierarchy without locking palette colors", () => {
  const swiss = styleById("swiss");
  assert.match(swiss.prompt, /huge ultra-bold geometric grotesk sans serif/i);
  assert.match(swiss.prompt, /does not fill the available width, left-justify/i);
  assert.doesNotMatch(swiss.prompt, /lower margin|beneath the map/i);
  assert.doesNotMatch(swiss.prompt, /off-white paper|hairline grey|accent-color/i);
});

test("Bauhaus locks elementary forms and Bayer type without locking hues", () => {
  const bauhaus = styleById("bauhaus");
  assert.match(bauhaus.prompt, /flat color fills preserving their supplied outlines/i);
  assert.match(bauhaus.prompt, /Herbert Bayer/i);
  assert.match(bauhaus.prompt, /lowercase/i);
  assert.doesNotMatch(bauhaus.prompt, /mountain|peak/i);
  const auto = resolveStyleColor(bauhaus, AUTO_PALETTE_ID);
  assert.equal(auto.openPalette, false);
  assert.deepEqual(auto.palette, ["red", "yellow", "blue", "black", "white"]);
  assert.doesNotMatch(auto.prompt, /\bred\b|\byellow\b|\bblue\b/i);
  assert.deepEqual(resolveStyleColor(bauhaus, "exhibition").palette, ["yellow", "red", "black"]);
});

test("Modernist locks mid-century silhouettes and mixed-case sans without locking hues", () => {
  const modernist = styleById("modernist");
  assert.match(modernist.prompt, /flat silhouettes preserving their supplied outlines/i);
  assert.match(modernist.prompt, /Paul Rand and Saul Bass/i);
  assert.match(modernist.prompt, /mixed case/i);
  assert.doesNotMatch(modernist.prompt, /mountain|peak|circle|square|triangle/i);
  const auto = resolveStyleColor(modernist, AUTO_PALETTE_ID);
  assert.equal(auto.openPalette, false);
  assert.deepEqual(auto.palette, ["mustard", "charcoal", "cream", "terracotta"]);
  assert.doesNotMatch(auto.prompt, /\bmustard\b|\bterracotta\b|\bturquoise\b|\bolive\b/i);
  assert.deepEqual(resolveStyleColor(modernist, "pool").palette, ["turquoise", "sand", "charcoal"]);
});

test("legacy canonical Auto resolves to the default named palette", () => {
  const swiss = resolveStyleColor(styleById("swiss"), AUTO_PALETTE_ID);
  assert.equal(swiss.openPalette, false);
  assert.equal(swiss.paletteId, "red");
  assert.deepEqual(swiss.palette, ["off-white", "grey", "red"]);
  assert.doesNotMatch(swiss.prompt, /\bred\b/i);
  const locked = resolveStyleColor(styleById("swiss"), "process-blue");
  assert.deepEqual(locked.palette, ["off-white", "grey", "process-blue"]);
});

test("Risograph defaults to fluorescent pink and teal and migrates legacy Auto", () => {
  const riso = resolveStyleColor(styleById("risograph"), AUTO_PALETTE_ID);
  assert.equal(riso.openPalette, false);
  assert.equal(riso.paletteId, "pink-teal");
  assert.deepEqual(riso.palette, ["fluorescent-pink", "teal"]);
  assert.doesNotMatch(styleById("risograph").prompt, /fluorescent pink|\bpink\b/i);
  assert.equal(paletteChoices(styleById("risograph")).some((p) => p.id === AUTO_PALETTE_ID), false);
  assert.deepEqual(paletteIdsForStyle(styleById("risograph"), ["auto", "pink-teal"]), ["pink-teal"]);
  assert.equal(specForSlot({ "risograph::auto": "legacy" }, "risograph", "pink-teal"), "legacy");
});

test("Watercolor remains free to choose washes from the geography", () => {
  const watercolour = resolveStyleColor(styleById("watercolour"), AUTO_PALETTE_ID);
  assert.equal(watercolour.openPalette, true);
  assert.deepEqual(watercolour.palette, []);
  assert.equal(showsPalettePicker(styleById("watercolour")), false);
});

test("Risograph presets lock drums without changing the process prompt", () => {
  const riso = resolveStyleColor(styleById("risograph"), "pink-teal");
  assert.equal(riso.openPalette, false);
  assert.deepEqual(riso.palette, ["fluorescent-pink", "teal"]);
  assert.equal(riso.prompt, styleById("risograph").prompt);
  assert.equal(normalizePaletteId(styleById("risograph"), "nope"), "pink-teal");
});

test("themes default to their signature palettes", () => {
  const defaults = { swiss: "red", modernist: "studio", risograph: "pink-teal", wpa: "park", "art-deco": "black-gold", "linen-postcard": "chrome", "art-nouveau": "mucha-spring", bauhaus: "primary", rpg: "overworld" };
  for (const [id, paletteId] of Object.entries(defaults)) {
    const style = styleById(id);
    assert.equal(defaultPaletteId(style), paletteId, id);
    assert.deepEqual(resolveStyleColor(style).palette, style.palette, id);
  }
});

test("canonical palettes omit Auto while open palettes retain it", () => {
  const costume = POSTER_STYLES.filter((item) => isCostumeStyle(item) && showsPalettePicker(item));
  assert.ok(costume.length >= 8);
  for (const style of costume) {
    assert.ok((style.palettes?.length ?? 0) >= 3, style.id);
    assert.equal(paletteChoices(style).some((item) => item.id === AUTO_PALETTE_ID), style.colorMode === "open", style.id);
    assert.equal(defaultPaletteId(style), style.colorMode === "open" ? AUTO_PALETTE_ID : style.palettes![0].id, style.id);
    assert.deepEqual(paletteIdsForStyle(style, ["auto", defaultPaletteId(style)]), [defaultPaletteId(style)], style.id);
  }
});

test("paletteIdsForStyle defaults missing and unknown ids to the named default", () => {
  assert.deepEqual(paletteIdsForStyle(styleById("swiss")), ["red"]);
  assert.deepEqual(paletteIdsForStyle(styleById("swiss"), ["process-blue", "nope", "black"]), [
    "process-blue",
    "red",
    "black",
  ]);
  assert.deepEqual(paletteIdsForStyle(styleById("blueprint"), ["red"]), [AUTO_PALETTE_ID]);
});

test("stylePlanSlots expands each selected palette per style", () => {
  const slots = stylePlanSlots(["swiss", "risograph", "blueprint"], {
    swiss: ["auto", "black"],
    risograph: ["pink-teal"],
  });
  assert.deepEqual(
    slots.map((slot) => slot.key),
    ["swiss::red", "swiss::black", "risograph::pink-teal", "blueprint::auto"],
  );
  assert.equal(planSlotLabel("swiss", "black"), "Minimal · Black");
  assert.equal(planSlotLabel("swiss", "auto"), "Minimal · Red");
  assert.equal(planSlotLabel("blueprint", "auto"), "Blueprint");
  assert.deepEqual(parsePlanSlotKey("swiss::process-blue"), { styleId: "swiss", paletteId: "process-blue" });
  assert.deepEqual(parsePlanSlotKey("swiss"), { styleId: "swiss", paletteId: AUTO_PALETTE_ID });
  assert.equal(planSlotKey("swiss", "black"), "swiss::black");
});

test("specForSlot preserves legacy Auto plans for the named default", () => {
  const specs = { swiss: "legacy", "swiss::black": "named" };
  assert.equal(specForSlot(specs, "swiss", "black"), "named");
  assert.equal(specForSlot(specs, "swiss", AUTO_PALETTE_ID), "legacy");
  assert.equal(specForSlot({ "swiss::auto": "slot" }, "swiss", AUTO_PALETTE_ID), "slot");
  assert.equal(specForSlot({ "swiss::auto": "slot" }, "swiss", "red"), "slot");
  assert.equal(specForSlot({ "swiss::auto": "slot", "swiss::red": "named" }, "swiss", "red"), "named");
  assert.equal(specForSlot({ "swiss::auto": "slot" }, "swiss", "black"), undefined);
});


test("themes preserve geometry and permit title wrapping", () => {
  for (const id of ["bauhaus", "modernist"]) {
    assert.match(POSTER_STYLES.find(style => style.id === id)!.prompt, /preserving their supplied outlines and positions/);
  }
});

test("eight theme/palette selections allow replacements and restored setup removals, but reject a ninth", async () => {
  const { canChangeThemeSelections, MAX_THEME_SELECTIONS } = await import("./styles");
  assert.equal(MAX_THEME_SELECTIONS, 8);
  assert.equal(canChangeThemeSelections(7, 8), true);
  assert.equal(canChangeThemeSelections(8, 9), false);
  assert.equal(canChangeThemeSelections(8, 8), true, "palette replacement is permitted");
  assert.equal(canChangeThemeSelections(11, 10), true, "old setups can be reduced without losing all selections");
  assert.equal(canChangeThemeSelections(11, 12), false);
  assert.equal(stylePlanSlots(POSTER_STYLES.slice(0, 8).map(style => style.id)).length, 8);
  const slots = stylePlanSlots(["swiss"], { "swiss": paletteChoices(styleById("swiss")).slice(0, 4).map(palette => palette.id) });
  assert.equal(slots.length, 4, "four palettes of one theme count as four selections");
});

test("account selection limits can be raised or unlimited while retaining default enforcement", () => {
  assert.equal(canChangeThemeSelections(8, 9), false);
  assert.equal(canChangeThemeSelections(8, 9, 32), true);
  assert.equal(canChangeThemeSelections(32, 33, 32), false);
  assert.equal(canChangeThemeSelections(32, 33, Infinity), true);
});
