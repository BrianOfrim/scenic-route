import rawManifest from "./themeExamples.json";
import { POSTER_STYLES, paletteChoices } from "./styles";

export type ThemeExample = {
  styleId: string;
  paletteId: string;
  thumbnail: string;
  image: string;
  /** Swatch and glow color, sampled from the thumbnail. */
  accent: [number, number, number];
};

export const THEME_EXAMPLE_ROUTE = "Martin Goodman Trail";

/** Tallest the landing explorer draws a poster, in CSS pixels. */
export const EXPLORER_POSTER_MAX_CSS_PX = 800;

const manifest = rawManifest as ThemeExample[];

export function examplesForTheme(styleId: string, examples: ThemeExample[] = manifest) {
  const style = POSTER_STYLES.find((item) => item.id === styleId);
  if (!style || styleId === "custom") return [];
  const order = paletteChoices(style).map((palette) => palette.id);
  return examples.filter((example) => example.styleId === styleId && order.includes(example.paletteId))
    .sort((a, b) => order.indexOf(a.paletteId) - order.indexOf(b.paletteId));
}

export const THEME_EXAMPLES: ThemeExample[] = manifest;
