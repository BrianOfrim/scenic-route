export const AUTO_PALETTE_ID = "auto";

/**
 * Kept in lockstep with TITLE_PHONE_CLAUSE in apps/api/src/posterSpec.ts.
 * Preset typography carries it so the planner copies a phone-readable title.
 */
export const TITLE_PHONE_CLAUSE =
  "Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 16% of the poster width.";

function titleFace(face: string) {
  return `${face}. ${TITLE_PHONE_CLAUSE}`;
}

export type ColorMode = "identity" | "canonical" | "open";

export type StylePalette = {
  id: string;
  label: string;
  colors: string[];
};

export type PosterStyle = {
  id: string;
  label: string;
  prompt: string;
  palette: string[];
  typography: string;
  colorMode: ColorMode;
  palettes?: StylePalette[];
  openHint?: string;
};

export const POSTER_STYLES: PosterStyle[] = [
  {
    id: "middle-earth",
    label: "Middle-earth",
    prompt:
      "Hand-inked map on aged parchment in the style of a Tolkien journey map. Tree-cluster forests, calligraphic labels, an ornate compass rose, and a decorative cartouche for the title. The route is a red dotted journey line. Warm tea-stain paper, sepia ink, no modern cartography.",
    palette: ["tea-stain", "sepia", "oxblood"],
    typography: titleFace("calligraphic uncials"),
    colorMode: "identity",
  },
  {
    id: "vintage-topo",
    label: "Vintage topo",
    prompt:
      "Vintage USGS topographic map: dense brown contour lines, tan and sage hypsometric tints, serif labels, neatline and grid ticks, a bold red route overprinted on the sheet. Slightly yellowed paper, lithographic print texture.",
    palette: ["tan", "sage", "sienna", "red"],
    typography: titleFace("engraved serif"),
    colorMode: "identity",
  },
  {
    id: "swiss",
    label: "Swiss minimal",
    prompt:
      "Swiss modernist map poster: hairline roads, a single accent route, generous negative space, no ornament, no texture beyond a faint paper tooth. Make the title the dominant graphic element: huge ultra-bold geometric grotesk sans serif, with tight but readable tracking, a single clean baseline, and a wide, confident wordmark. When the title block does not fill the available width, left-justify the title and its date, distance, and duration line; otherwise use the composition's natural balance. Set the date, distance, and duration in the same sans serif at a smaller regular weight with middle-dot separators. Preserve ample blank space around the type; crisp lettering only, with no decorative forms, serifs, outlines, shadows, or small timid title.",
    palette: ["off-white", "grey", "red"],
    typography: titleFace("huge ultra-bold geometric grotesk title with smaller regular sans metadata"),
    colorMode: "canonical",
    palettes: [
      { id: "red", label: "Red", colors: ["off-white", "grey", "red"] },
      { id: "black", label: "Black", colors: ["off-white", "grey", "black"] },
      { id: "process-blue", label: "Process blue", colors: ["off-white", "grey", "process-blue"] },
      { id: "signal-yellow", label: "Signal yellow", colors: ["off-white", "grey", "signal-yellow"] },
    ],
  },
  {
    id: "blueprint",
    label: "Blueprint",
    prompt:
      "Cyanotype architectural blueprint: deep cyan paper, white technical linework, dimension ticks and a stamped title block. The route is a heavier white line. Drafting-room precision, no color besides cyan and white.",
    palette: ["cyan", "white"],
    typography: titleFace("stamped technical sans"),
    colorMode: "identity",
  },
  {
    id: "wpa",
    label: "WPA park",
    prompt:
      "1930s WPA National Park poster: flat bold poster colors, screen-print grain, big stacked title, simplified landforms, a heroic composition. The route is a strong graphic path through the landscape.",
    palette: ["poster-orange", "forest-green", "cream"],
    typography: titleFace("stacked gothic"),
    colorMode: "canonical",
    palettes: [
      { id: "park", label: "Park", colors: ["poster-orange", "forest-green", "cream"] },
      { id: "desert", label: "Desert", colors: ["terracotta", "turquoise", "sand"] },
      { id: "alpine", label: "Alpine", colors: ["navy", "cream", "scarlet"] },
      { id: "coast", label: "Coast", colors: ["sea-blue", "cream", "coral"] },
    ],
  },
  {
    id: "watercolour",
    label: "Watercolour journal",
    prompt:
      "Travel journal watercolour: loose wet-on-wet washes, fine ink outlines, handwritten labels, visible paper texture and paint blooms. Soft, personal, not a printed atlas.",
    palette: [],
    typography: titleFace("handwritten ink"),
    colorMode: "open",
    openHint: "Choose washes from the land and water in the frame; do not lock a preset trio.",
  },
  {
    id: "star-chart",
    label: "Star chart",
    prompt:
      "Celestial chart: deep navy field, the route as a constellation of linked gold stars, gold serif labels, decorative celestial border and corner flourishes. No daylight landscape.",
    palette: ["navy", "gold"],
    typography: titleFace("gold serif"),
    colorMode: "identity",
  },
  {
    id: "transit",
    label: "Transit diagram",
    prompt:
      "Beck-style transit diagram: 45-degree and horizontal lines only, landmarks as named station dots, a bold route, and small sans-serif tags. Schematic, not geographic texture. Use a clean Swiss/neo-grotesk sans-serif system: set the title in a very large, ultra-bold, tightly tracked sans serif. Set the date, distance, and duration in the same typeface at a smaller semibold weight with middle-dot separators. Keep the title on one line; crisp, flat vector lettering only, with no hand lettering, serifs, outlines, shadows, or decorative effects.",
    palette: ["cream", "route-red", "navy"],
    typography: titleFace("ultra-bold neo-grotesk header title with semibold sans metadata"),
    colorMode: "canonical",
    palettes: [
      { id: "central-red", label: "Central red", colors: ["cream", "route-red", "navy"] },
      { id: "victoria-blue", label: "Victoria blue", colors: ["cream", "victoria-blue", "navy"] },
      { id: "district-green", label: "District green", colors: ["cream", "district-green", "navy"] },
      { id: "circle-yellow", label: "Circle yellow", colors: ["cream", "circle-yellow", "navy"] },
    ],
  },
  {
    id: "art-deco",
    label: "Art deco",
    prompt:
      "Art deco travel poster: geometric forms, sunburst behind the title, stylized typography, stepped frames, simplified landforms. Elegant 1920s luxury-line advertisement.",
    palette: ["gold", "teal", "cream"],
    typography: titleFace("geometric deco"),
    colorMode: "canonical",
    palettes: [
      { id: "luxury-line", label: "Luxury line", colors: ["gold", "teal", "cream"] },
      { id: "black-gold", label: "Black and gold", colors: ["black", "gold", "ivory"] },
      { id: "ocean-liner", label: "Ocean liner", colors: ["silver", "navy", "cream"] },
      { id: "jazz-club", label: "Jazz club", colors: ["coral", "black", "cream"] },
    ],
  },
  {
    id: "rpg",
    label: "16-bit RPG",
    prompt:
      "16-bit RPG overworld map: chunky pixel tiles, sprite-like landmarks, dotted path for the route, limited NES-era palette, no anti-aliasing. Looks like a pause-screen map from a 1990s SNES game.",
    palette: ["nes-green", "nes-blue", "nes-tan"],
    typography: titleFace("pixel caps"),
    colorMode: "canonical",
    palettes: [
      { id: "overworld", label: "Overworld", colors: ["nes-green", "nes-blue", "nes-tan"] },
      { id: "dungeon", label: "Dungeon", colors: ["slate", "purple", "gold"] },
      { id: "winter", label: "Winter", colors: ["ice", "grey", "navy"] },
      { id: "desert", label: "Desert", colors: ["tan", "orange", "brown"] },
    ],
  },
  {
    id: "risograph",
    label: "Risograph",
    prompt:
      "Two-ink risograph print: slight misregistration, coarse halftone dots, cheap paper grain. The route is the louder ink. Handmade zine energy.",
    palette: [],
    typography: titleFace("zine sans"),
    colorMode: "open",
    openHint: "Pick any two Riso inks.",
    palettes: [
      { id: "pink-teal", label: "Fluorescent pink + teal", colors: ["fluorescent-pink", "teal"] },
      { id: "blue-sunflower", label: "Federal blue + sunflower", colors: ["federal-blue", "sunflower"] },
      { id: "black-red", label: "Black + bright red", colors: ["black", "bright-red"] },
      { id: "orange-teal", label: "Fluorescent orange + teal", colors: ["fluorescent-orange", "teal"] },
      { id: "kelly-cornflower", label: "Kelly + cornflower", colors: ["kelly", "cornflower"] },
    ],
  },
  {
    id: "linen-postcard",
    label: "Linen postcard",
    prompt:
      "1950s American linen postcard: faded canvas weave, stacked Greetings-from lettering for the title, a highway-shield cartouche. The route is a bold road-trip line. Mid-century roadside Americana, no parchment and no neon.",
    palette: ["linen-cream", "chrome-teal", "bumper-red"],
    typography: titleFace("stacked greetings-from"),
    colorMode: "canonical",
    palettes: [
      { id: "chrome", label: "Chrome", colors: ["linen-cream", "chrome-teal", "bumper-red"] },
      { id: "sunset", label: "Sunset", colors: ["linen-cream", "aqua", "postcard-orange"] },
      { id: "desert", label: "Desert", colors: ["peach", "turquoise", "sand"] },
      { id: "civic", label: "Civic", colors: ["linen-cream", "navy", "barn-red"] },
    ],
  },
  {
    id: "art-nouveau",
    label: "Art nouveau",
    prompt:
      "Art nouveau travel poster in the manner of Mucha: organic vine frames, flowing hairline borders, a decorative title cartouche. The route is a single elegant path. Belle-époque luxury, floral and curved, not geometric deco.",
    palette: ["cream", "gold-green", "muted-rose"],
    typography: titleFace("flowing nouveau"),
    colorMode: "canonical",
    palettes: [
      { id: "mucha-spring", label: "Mucha spring", colors: ["cream", "gold-green", "muted-rose"] },
      { id: "twilight", label: "Twilight", colors: ["ivory", "violet", "gold"] },
      { id: "autumn", label: "Autumn", colors: ["cream", "olive", "russet"] },
      { id: "peacock", label: "Peacock", colors: ["cream", "teal", "gold"] },
    ],
  },
  {
    id: "custom",
    label: "Custom",
    prompt: "",
    palette: [],
    typography: "",
    colorMode: "identity",
  },
];

/** Product default for new poster setups (one-tap generate). */
export const DEFAULT_STYLE_ID = "risograph";

export const DEFAULT_POSTER_STYLE =
  POSTER_STYLES.find((item) => item.id === DEFAULT_STYLE_ID) ?? POSTER_STYLES[0];

export function styleById(id: string): PosterStyle {
  return POSTER_STYLES.find((item) => item.id === id) ?? DEFAULT_POSTER_STYLE;
}

export function styleLabel(id: string, fallback?: string): string {
  const match = POSTER_STYLES.find((item) => item.id === id);
  if (match) return match.label;
  const trimmed = fallback?.trim();
  return trimmed || id || "Unknown theme";
}

export function isCostumeStyle(style: PosterStyle): boolean {
  return style.colorMode === "canonical" || style.colorMode === "open";
}

export function stylePalettes(style: PosterStyle): StylePalette[] {
  return style.palettes ?? [];
}

export function showsPalettePicker(style: PosterStyle): boolean {
  return isCostumeStyle(style) && stylePalettes(style).length > 0;
}

export function normalizePaletteId(style: PosterStyle, paletteId?: string | null): string {
  if (!showsPalettePicker(style)) return AUTO_PALETTE_ID;
  if (!paletteId || paletteId === AUTO_PALETTE_ID) return AUTO_PALETTE_ID;
  return stylePalettes(style).some((item) => item.id === paletteId) ? paletteId : AUTO_PALETTE_ID;
}

export function paletteIdsForStyle(style: PosterStyle, selected?: string[] | null): string[] {
  if (!showsPalettePicker(style)) return [AUTO_PALETTE_ID];
  const ids = [...new Set((selected ?? []).map((id) => normalizePaletteId(style, id)))];
  return ids.length ? ids : [AUTO_PALETTE_ID];
}

export function planSlotKey(styleId: string, paletteId: string) {
  return `${styleId}::${paletteId}`;
}

export function parsePlanSlotKey(key: string): { styleId: string; paletteId: string } {
  const split = key.indexOf("::");
  if (split < 0) return { styleId: key, paletteId: AUTO_PALETTE_ID };
  return { styleId: key.slice(0, split), paletteId: key.slice(split + 2) };
}

export function stylePlanSlots(
  styleIds: string[],
  paletteIdsByStyle?: Record<string, string[] | undefined>,
): Array<{ styleId: string; paletteId: string; key: string }> {
  return styleIds.flatMap((styleId) => {
    const style = styleById(styleId);
    return paletteIdsForStyle(style, paletteIdsByStyle?.[styleId]).map((paletteId) => ({
      styleId,
      paletteId,
      key: planSlotKey(styleId, paletteId),
    }));
  });
}

export function paletteChoiceLabel(style: PosterStyle, paletteId: string) {
  if (paletteId === AUTO_PALETTE_ID) return "Auto";
  return stylePalettes(style).find((item) => item.id === paletteId)?.label ?? paletteId;
}

export function planSlotLabel(styleId: string, paletteId: string, fallback?: string) {
  const theme = styleLabel(styleId, fallback);
  if (!showsPalettePicker(styleById(styleId))) return theme;
  return `${theme} · ${paletteChoiceLabel(styleById(styleId), paletteId)}`;
}

export function specForSlot<T>(
  specs: Partial<Record<string, T>>,
  styleId: string,
  paletteId: string,
): T | undefined {
  return specs[planSlotKey(styleId, paletteId)] ?? (paletteId === AUTO_PALETTE_ID ? specs[styleId] : undefined);
}

export function snapshotPaletteIds(
  styleIds: string[],
  paletteIdsByStyle?: Record<string, string[] | undefined> | null,
  legacyPaletteId?: string | null,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const id of styleIds) {
    const style = styleById(id);
    const fromMap = paletteIdsByStyle?.[id];
    const fallback = !fromMap?.length && styleIds.length === 1 && legacyPaletteId ? [legacyPaletteId] : undefined;
    next[id] = paletteIdsForStyle(style, fromMap ?? fallback);
  }
  return next;
}

export type ResolvedStyleColor = {
  paletteId: string;
  palette: string[];
  prompt: string;
  openPalette: boolean;
};

export function resolveStyleColor(style: PosterStyle, paletteId?: string | null): ResolvedStyleColor {
  const id = normalizePaletteId(style, paletteId);
  if (style.colorMode === "identity") {
    return { paletteId: AUTO_PALETTE_ID, palette: style.palette, prompt: style.prompt, openPalette: false };
  }
  const preset = stylePalettes(style).find((item) => item.id === id);
  if (preset) {
    return { paletteId: id, palette: preset.colors, prompt: style.prompt, openPalette: false };
  }
  if (style.colorMode === "open") {
    const hint = style.openHint?.trim();
    return {
      paletteId: AUTO_PALETTE_ID,
      palette: [],
      prompt: hint ? `${style.prompt} ${hint}` : style.prompt,
      openPalette: true,
    };
  }
  return {
    paletteId: AUTO_PALETTE_ID,
    palette: stylePalettes(style)[0]?.colors ?? style.palette,
    prompt: style.prompt,
    openPalette: false,
  };
}
