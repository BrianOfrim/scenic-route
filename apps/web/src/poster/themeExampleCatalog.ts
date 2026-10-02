import manifest from "./themeExamples.json";
import { AUTO_PALETTE_ID, POSTER_STYLES, stylePalettes } from "./styles";

export type ThemeExample = {
  styleId: string;
  paletteId: string;
  thumbnail: string;
  image: string;
};

export function examplesForTheme(styleId: string, examples: ThemeExample[] = manifest) {
  const style = POSTER_STYLES.find((item) => item.id === styleId);
  if (!style || styleId === "custom") return [];
  const order = [AUTO_PALETTE_ID, ...stylePalettes(style).map((palette) => palette.id)];
  return examples.filter((example) => example.styleId === styleId && order.includes(example.paletteId))
    .sort((a, b) => order.indexOf(a.paletteId) - order.indexOf(b.paletteId));
}

export const THEME_EXAMPLES: ThemeExample[] = manifest;
