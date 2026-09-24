import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_PALETTE_ID,
  DEFAULT_POSTER_STYLE,
  POSTER_STYLES,
  TITLE_PHONE_CLAUSE,
  isCostumeStyle,
  normalizePaletteId,
  paletteIdsForStyle,
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
  "star-chart": /navy field|gold stars/i,
};

const COSTUME_CLICHE: Record<string, RegExp> = {
  swiss: /\bred\b/i,
  wpa: /poster-orange|forest-green/i,
  watercolour: /wash-blue|sap-green/i,
  transit: /route-red/i,
  "art-deco": /gold and teal|\bgold\b|\bteal\b/i,
  rpg: /nes-green|nes-blue|nes-tan/i,
  risograph: /fluorescent pink|\bteal\b/i,
  "linen-postcard": /chrome-teal|bumper-red|chrome bumper/i,
  "art-nouveau": /gold-green|muted-rose/i,
};

test("preset typography requires a phone-readable title and custom adds none", () => {
  assert.match(TITLE_PHONE_CLAUSE, /16% of the poster width/);
  assert.match(TITLE_PHONE_CLAUSE, /not a zoomed crop/);
  for (const style of POSTER_STYLES) {
    if (style.id === "custom") {
      assert.equal(style.typography, "");
      continue;
    }
    assert.match(style.typography, /clearly readable when the whole poster is viewed on a phone/, style.id);
    assert.match(style.typography, /16% of the poster width/, style.id);
  }
});

test("default poster style is Risograph", () => {
  assert.equal(DEFAULT_POSTER_STYLE.id, "risograph");
  assert.equal(DEFAULT_POSTER_STYLE.label, "Risograph");
});

test("Linocut is not available as a new-poster style", () => {
  assert.equal(POSTER_STYLES.some((style) => style.id === "linocut"), false);
});

test("styleById returns the matching preset", () => {
  assert.equal(styleById("blueprint").label, "Blueprint");
  assert.equal(styleById("linen-postcard").label, "Linen postcard");
  assert.equal(styleById("art-nouveau").label, "Art nouveau");
  assert.equal(styleById("missing").id, DEFAULT_POSTER_STYLE.id);
});

test("styleLabel prefers the preset, then a fallback name", () => {
  assert.equal(styleLabel("swiss"), "Swiss minimal");
  assert.equal(styleLabel("made-up", "Ink wash"), "Ink wash");
  assert.equal(styleLabel(""), "Unknown theme");
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

test("Swiss and transit prompts lock the GPT-inspired type hierarchy without locking palette colors", () => {
  const swiss = styleById("swiss");
  assert.match(swiss.prompt, /huge ultra-bold geometric grotesk sans serif/i);
  assert.match(swiss.prompt, /does not fill the available width, left-justify/i);
  assert.doesNotMatch(swiss.prompt, /lower margin|beneath the map/i);
  assert.doesNotMatch(swiss.prompt, /off-white paper|hairline grey|accent-color/i);

  const transit = styleById("transit");
  assert.match(transit.prompt, /very large, ultra-bold, tightly tracked sans serif/i);
  assert.doesNotMatch(transit.prompt, /centered|header band|above the map|directly beneath/i);
  assert.doesNotMatch(transit.prompt, /colored route|cream field/i);
});

test("canonical Auto uses the first named palette", () => {
  const swiss = resolveStyleColor(styleById("swiss"), AUTO_PALETTE_ID);
  assert.equal(swiss.openPalette, false);
  assert.deepEqual(swiss.palette, ["off-white", "grey", "red"]);
  assert.doesNotMatch(swiss.prompt, /\bred\b/i);
  const locked = resolveStyleColor(styleById("swiss"), "process-blue");
  assert.deepEqual(locked.palette, ["off-white", "grey", "process-blue"]);
});

test("open Auto omits colors and does not reintroduce the cliché pair", () => {
  const riso = resolveStyleColor(styleById("risograph"), AUTO_PALETTE_ID);
  assert.equal(riso.openPalette, true);
  assert.deepEqual(riso.palette, []);
  assert.doesNotMatch(styleById("risograph").prompt, /fluorescent pink|\bpink\b/i);
  assert.doesNotMatch(riso.prompt, /fluorescent pink|\bteal\b/i);
  assert.match(riso.prompt, /Pick any two Riso inks/i);
  const watercolour = resolveStyleColor(styleById("watercolour"), AUTO_PALETTE_ID);
  assert.equal(watercolour.openPalette, true);
  assert.deepEqual(watercolour.palette, []);
  assert.equal(showsPalettePicker(styleById("watercolour")), false);
});

test("open presets lock drums without changing the process prompt", () => {
  const riso = resolveStyleColor(styleById("risograph"), "pink-teal");
  assert.equal(riso.openPalette, false);
  assert.deepEqual(riso.palette, ["fluorescent-pink", "teal"]);
  assert.equal(riso.prompt, styleById("risograph").prompt);
  assert.equal(normalizePaletteId(styleById("risograph"), "nope"), AUTO_PALETTE_ID);
});

test("every costume style with palettes has Auto plus named presets", () => {
  const costume = POSTER_STYLES.filter((item) => isCostumeStyle(item) && showsPalettePicker(item));
  assert.ok(costume.length >= 8);
  for (const style of costume) {
    assert.ok((style.palettes?.length ?? 0) >= 3, style.id);
  }
});

test("paletteIdsForStyle keeps Auto when empty and drops unknown ids", () => {
  assert.deepEqual(paletteIdsForStyle(styleById("swiss")), [AUTO_PALETTE_ID]);
  assert.deepEqual(paletteIdsForStyle(styleById("swiss"), ["process-blue", "nope", "black"]), [
    "process-blue",
    AUTO_PALETTE_ID,
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
    ["swiss::auto", "swiss::black", "risograph::pink-teal", "blueprint::auto"],
  );
  assert.equal(planSlotLabel("swiss", "black"), "Swiss minimal · Black");
  assert.equal(planSlotLabel("blueprint", "auto"), "Blueprint");
  assert.deepEqual(parsePlanSlotKey("swiss::process-blue"), { styleId: "swiss", paletteId: "process-blue" });
  assert.deepEqual(parsePlanSlotKey("swiss"), { styleId: "swiss", paletteId: AUTO_PALETTE_ID });
  assert.equal(planSlotKey("swiss", "black"), "swiss::black");
});

test("specForSlot prefers a slot key and falls back to a legacy style key for Auto", () => {
  const specs = { swiss: "legacy", "swiss::black": "named" };
  assert.equal(specForSlot(specs, "swiss", "black"), "named");
  assert.equal(specForSlot(specs, "swiss", AUTO_PALETTE_ID), "legacy");
  assert.equal(specForSlot({ "swiss::auto": "slot" }, "swiss", AUTO_PALETTE_ID), "slot");
});
