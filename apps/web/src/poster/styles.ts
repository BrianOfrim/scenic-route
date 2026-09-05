export type PosterStyle = {
  id: string;
  label: string;
  prompt: string;
  palette: string[];
  typography: string;
};

export const POSTER_STYLES: PosterStyle[] = [
  {
    id: "middle-earth",
    label: "Middle-earth",
    prompt:
      "Hand-inked map on aged parchment in the style of a Tolkien journey map. Hachured mountains, tree-cluster forests, calligraphic labels, an ornate compass rose, and a decorative cartouche for the title. The route is a red dotted journey line. Warm tea-stain paper, sepia ink, no modern cartography.",
    palette: ["tea-stain", "sepia", "oxblood"],
    typography: "calligraphic uncials",
  },
  {
    id: "vintage-topo",
    label: "Vintage topo",
    prompt:
      "Vintage USGS topographic map: dense brown contour lines, tan and sage hypsometric tints, serif labels, neatline and grid ticks, a bold red route overprinted on the sheet. Slightly yellowed paper, lithographic print texture.",
    palette: ["tan", "sage", "sienna", "red"],
    typography: "engraved serif",
  },
  {
    id: "tron",
    label: "Tron lightcycle",
    prompt:
      "Tron lightcycle world: matte black void, cyan neon grid roads receding into darkness, the route a blazing orange light trail with bloom and glow. HUD typography for the title, scanlines, no parchment or paper.",
    palette: ["black", "cyan", "orange"],
    typography: "HUD gothic",
  },
  {
    id: "swiss",
    label: "Swiss minimal",
    prompt:
      "Swiss modernist map poster: off-white paper, hairline grey roads, a single accent-color route, Helvetica title block, generous negative space, no ornament, no texture beyond a faint paper tooth.",
    palette: ["off-white", "grey", "red"],
    typography: "Helvetica",
  },
  {
    id: "blueprint",
    label: "Blueprint",
    prompt:
      "Cyanotype architectural blueprint: deep cyan paper, white technical linework, dimension ticks and a stamped title block. The route is a heavier white line. Drafting-room precision, no color besides cyan and white.",
    palette: ["cyan", "white"],
    typography: "stamped technical sans",
  },
  {
    id: "ukiyo-e",
    label: "Ukiyo-e",
    prompt:
      "Japanese ukiyo-e woodblock print: Hokusai-style waves for water, stylized peaks, indigo and ochre palette, visible woodgrain, a red seal stamp containing the title. Flat color fields, outlined forms, no photorealism.",
    palette: ["indigo", "ochre", "seal-red"],
    typography: "woodblock seal",
  },
  {
    id: "wpa",
    label: "WPA park poster",
    prompt:
      "1930s WPA National Park poster: flat bold poster colors, screen-print grain, big stacked title, simplified landforms, a heroic composition. The route is a strong graphic path through the landscape.",
    palette: ["poster-orange", "forest-green", "cream"],
    typography: "stacked gothic",
  },
  {
    id: "synthwave",
    label: "Synthwave",
    prompt:
      "Synthwave poster: sunset magenta-to-orange gradient sky, neon grid ground plane, chrome script title, purple haze mountains. The route is a glowing neon path. Retro-futurist 1980s album art.",
    palette: ["magenta", "orange", "violet"],
    typography: "chrome script",
  },
  {
    id: "pirate",
    label: "Pirate treasure",
    prompt:
      "Pirate treasure map on burnt-edge parchment: an X marks the finish, dotted route, a sea serpent in any lake, skull-and-crossbones compass, coffee stains and fold creases. Hand-lettered labels.",
    palette: ["parchment", "soot", "blood-red"],
    typography: "hand-lettered",
  },
  {
    id: "watercolour",
    label: "Watercolour journal",
    prompt:
      "Travel journal watercolour: loose wet-on-wet washes, fine ink outlines, handwritten labels, visible paper texture and paint blooms. Soft, personal, not a printed atlas.",
    palette: ["wash-blue", "sap-green", "ink"],
    typography: "handwritten ink",
  },
  {
    id: "star-chart",
    label: "Star chart",
    prompt:
      "Celestial chart: deep navy field, the route as a constellation of linked gold stars, gold serif labels, decorative celestial border and corner flourishes. No daylight landscape.",
    palette: ["navy", "gold"],
    typography: "gold serif",
  },
  {
    id: "transit",
    label: "Transit diagram",
    prompt:
      "Beck-style transit diagram: 45-degree and horizontal lines only, landmarks as named station dots, bold colored route on a cream field, small sans-serif tags. Schematic, not geographic texture.",
    palette: ["cream", "route-red", "navy"],
    typography: "small sans-serif",
  },
  {
    id: "art-deco",
    label: "Art deco",
    prompt:
      "Art deco travel poster: geometric gold and teal, sunburst behind the title, stylized typography, stepped frames, simplified landforms. Elegant 1920s luxury-line advertisement.",
    palette: ["gold", "teal", "cream"],
    typography: "geometric deco",
  },
  {
    id: "rpg",
    label: "16-bit RPG",
    prompt:
      "16-bit RPG overworld map: chunky pixel tiles, sprite-like landmarks, dotted path for the route, limited NES-era palette, no anti-aliasing. Looks like a pause-screen map from a 1990s SNES game.",
    palette: ["nes-green", "nes-blue", "nes-tan"],
    typography: "pixel caps",
  },
  {
    id: "risograph",
    label: "Risograph",
    prompt:
      "Two-ink risograph print: fluorescent pink and teal, slight misregistration, coarse halftone dots, cheap paper grain. The route is the louder ink. Handmade zine energy.",
    palette: ["fluorescent-pink", "teal"],
    typography: "zine sans",
  },
  {
    id: "telemetry",
    label: "Dark telemetry",
    prompt:
      "Dark endurance-sport telemetry poster: near-black field, route as a luminous speed-gradient trail, small monospace stat blocks, faint grid, no fantasy decoration.",
    palette: ["near-black", "lime", "ice"],
    typography: "monospace stats",
  },
  {
    id: "custom",
    label: "Custom",
    prompt: "",
    palette: [],
    typography: "",
  },
];

export const DEFAULT_POSTER_STYLE = POSTER_STYLES[0];
