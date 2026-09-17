/** Keep in sync with apps/web/src/poster/trailColors.ts */
export const TRAIL_SWATCHES = [
  { name: "teal", hex: "#0d9488" },
  { name: "amber", hex: "#d97706" },
  { name: "violet", hex: "#7c3aed" },
  { name: "sky", hex: "#0284c7" },
  { name: "magenta", hex: "#c026d3" },
  { name: "olive", hex: "#65a30d" },
  { name: "coral", hex: "#ea580c" },
  { name: "indigo", hex: "#4f46e5" },
  { name: "yellow", hex: "#eab308" },
  { name: "lime", hex: "#84cc16" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "rose", hex: "#e11d48" },
  { name: "brown", hex: "#9a3412" },
  { name: "navy", hex: "#1e3a8a" },
  { name: "pink", hex: "#db2777" },
  { name: "plum", hex: "#6b21a8" },
] as const;

/** Color words used in legacy "teal stretch…" planner copy. */
export const TRAIL_COLOR_NAMES = TRAIL_SWATCHES.map((swatch) => swatch.name);

export function trailColorName(index: number, explicit?: string) {
  const named = explicit?.trim();
  if (named) return named;
  return TRAIL_SWATCHES[index % TRAIL_SWATCHES.length].name;
}

export const TRAIL_TREATMENT = "write the name along that stretch";
