import { TRAIL_COLOR_NAMES } from "./trailColors";

export const DEFAULT_ASPECT_RATIO = "3:4";

/** gpt-image rejects 4:5. 3:4 is the nearest portrait it accepts. */
export function imageAspectRatio(value?: string | null): string {
  const ratio = value?.trim() || DEFAULT_ASPECT_RATIO;
  return ratio === "4:5" ? DEFAULT_ASPECT_RATIO : ratio;
}

export type PosterSpecStyle = {
  name: string;
  medium: string;
  palette: string[];
  typography: string;
  texture: string;
  references: string;
};

export type PosterSpecComposition = {
  aspectRatio: string;
  routePlacement: string;
  titleBlock: string;
  border: string;
  decorations: string[];
};

export type PosterSpecRoute = {
  treatment: string;
  color: string;
  startMarker: string;
  finishMarker: string;
  startName?: string;
  finishName?: string;
  shapeNotes: string;
};

export type PosterSpecGeography = {
  kind: string;
  name: string;
  placement: string;
  treatment: string;
  /** Schematic index color only. Never a poster paint instruction. */
  color?: string;
  /** Schematic wash letter only. Never a poster paint instruction. */
  letter?: string;
};

export type PosterSpecLandmark = {
  name: string;
  kind: string;
  placement: string;
  icon: string;
  /** 1-based disc on the schematic; 0 means "use array order". */
  pin: number;
};

export type PosterSpecText = {
  title: string;
  subtitle: string;
  stats: Array<{ label: string; value: string }>;
  rules: string;
};

export type PosterSpecGrounding = {
  images: Array<{ index: number; role: string; legend: string }>;
  rules: string[];
};

export type PosterSpec = {
  style: PosterSpecStyle;
  composition: PosterSpecComposition;
  route: PosterSpecRoute;
  geography: PosterSpecGeography[];
  landmarks: PosterSpecLandmark[];
  text: PosterSpecText;
  grounding: PosterSpecGrounding;
  negative: string[];
  finalPrompt: string;
};

export const POSTER_SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "style",
    "composition",
    "route",
    "geography",
    "landmarks",
    "text",
    "grounding",
    "negative",
    "finalPrompt",
  ],
  properties: {
    style: {
      type: "object",
      additionalProperties: false,
      required: ["name", "medium", "palette", "typography", "texture", "references"],
      properties: {
        name: { type: "string" },
        medium: { type: "string" },
        palette: { type: "array", items: { type: "string" } },
        typography: { type: "string" },
        texture: { type: "string" },
        references: { type: "string" },
      },
    },
    composition: {
      type: "object",
      additionalProperties: false,
      required: ["aspectRatio", "routePlacement", "titleBlock", "border", "decorations"],
      properties: {
        aspectRatio: { type: "string" },
        routePlacement: { type: "string" },
        titleBlock: { type: "string" },
        border: { type: "string" },
        decorations: { type: "array", items: { type: "string" } },
      },
    },
    route: {
      type: "object",
      additionalProperties: false,
      required: [
        "treatment",
        "color",
        "startMarker",
        "finishMarker",
        "startName",
        "finishName",
        "shapeNotes",
      ],
      properties: {
        treatment: { type: "string" },
        color: { type: "string" },
        startMarker: { type: "string" },
        finishMarker: { type: "string" },
        startName: { type: "string" },
        finishName: { type: "string" },
        shapeNotes: { type: "string" },
      },
    },
    geography: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "placement", "treatment", "color", "letter"],
        properties: {
          kind: { type: "string" },
          name: { type: "string" },
          placement: { type: "string" },
          treatment: { type: "string" },
          color: { type: "string" },
          letter: { type: "string" },
        },
      },
    },
    landmarks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind", "placement", "icon", "pin"],
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          placement: { type: "string" },
          icon: { type: "string" },
          pin: { type: "integer" },
        },
      },
    },
    text: {
      type: "object",
      additionalProperties: false,
      required: ["title", "subtitle", "stats", "rules"],
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        stats: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        rules: { type: "string" },
      },
    },
    grounding: {
      type: "object",
      additionalProperties: false,
      required: ["images", "rules"],
      properties: {
        images: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["index", "role", "legend"],
            properties: {
              index: { type: "integer" },
              role: { type: "string" },
              legend: { type: "string" },
            },
          },
        },
        rules: { type: "array", items: { type: "string" } },
      },
    },
    negative: { type: "array", items: { type: "string" } },
    finalPrompt: { type: "string" },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function validatePosterSpec(raw: unknown): PosterSpec {
  if (!isRecord(raw)) throw new Error("poster spec must be an object");
  const style = isRecord(raw.style) ? raw.style : {};
  const composition = isRecord(raw.composition) ? raw.composition : {};
  const route = isRecord(raw.route) ? raw.route : {};
  const text = isRecord(raw.text) ? raw.text : {};
  const grounding = isRecord(raw.grounding) ? raw.grounding : {};
  const spec: PosterSpec = {
    style: {
      name: asString(style.name),
      medium: asString(style.medium),
      palette: asStringArray(style.palette),
      typography: asString(style.typography),
      texture: asString(style.texture),
      references: asString(style.references),
    },
    composition: {
      aspectRatio: asString(composition.aspectRatio, DEFAULT_ASPECT_RATIO),
      routePlacement: asString(composition.routePlacement),
      titleBlock: asString(composition.titleBlock),
      border: asString(composition.border),
      decorations: asStringArray(composition.decorations),
    },
    route: {
      treatment: asString(route.treatment),
      color: asString(route.color),
      startMarker: asString(route.startMarker),
      finishMarker: asString(route.finishMarker),
      startName: asString(route.startName),
      finishName: asString(route.finishName),
      shapeNotes: asString(route.shapeNotes),
    },
    geography: Array.isArray(raw.geography)
      ? raw.geography.filter(isRecord).map((item) => ({
          kind: asString(item.kind),
          name: asString(item.name),
          placement: asString(item.placement),
          treatment: asString(item.treatment),
          color: asString(item.color) || undefined,
          letter: asString(item.letter) || undefined,
        }))
      : [],
    landmarks: Array.isArray(raw.landmarks)
      ? raw.landmarks.filter(isRecord).map((item, index) => ({
          name: asString(item.name),
          kind: asString(item.kind),
          placement: asString(item.placement),
          icon: asString(item.icon),
          pin: Number(item.pin) > 0 ? Math.round(Number(item.pin)) : index + 1,
        }))
      : [],
    text: {
      title: asString(text.title),
      subtitle: asString(text.subtitle),
      stats: Array.isArray(text.stats)
        ? text.stats.filter(isRecord).map((item) => ({
            label: asString(item.label),
            value: asString(item.value),
          }))
        : [],
      rules: asString(text.rules, "exact spelling, no other text"),
    },
    grounding: {
      images: Array.isArray(grounding.images)
        ? grounding.images.filter(isRecord).map((item) => ({
            index: Number(item.index) || 1,
            role: asString(item.role),
            legend: asString(item.legend),
          }))
        : [],
      rules: asStringArray(grounding.rules),
    },
    negative: asStringArray(raw.negative),
    finalPrompt: asString(raw.finalPrompt),
  };
  if (!spec.text.title.trim()) throw new Error("poster spec is missing a title");
  if (!spec.finalPrompt.trim()) {
    spec.finalPrompt = fallbackPrompt(spec);
  }
  return spec;
}

/** Things the reference schematic contains that must never be copied into the poster. */
export const PROMPT_EXCLUSIONS = [
  "no legend strip or color key",
  "no number-to-name legend or index",
  "no color-to-name legend or trail color key",
  "no letter-to-name region key",
  "no A/B/C wash letters on the finished poster",
  "no schematic ochre or brown wash color on named regions",
  "no named region drawn away from its lettered wash",
  "no schematic route colors on the finished path",
  "no multi-colored GPS track copied from the schematic",
  "no numbered landmark discs, pin numbers, or numbered callouts",
  "no latitude/longitude numbers, coordinates, or grid lines",
  "no scale bar, graphic scale, distance ruler, or map scale",
  "no watermark",
  "no different route than the GPS track on the schematic",
  "no smoothed, straightened, shortcut, or invented path",
  "no omitted out-and-backs, spurs, or crossings",
  "no labels or landmark illustrations covering, breaking, or replacing the route",
  "no landmark icon used as a destination or gap in the path",
];

const NAMED_TEXT_EXCLUSION =
  "no text other than the title block and the listed landmark, trail, region, and start/finish names";
const ROUTE_ONLY_TEXT_EXCLUSION =
  "no text other than the title block and optional start/finish names";
const ROUTE_ONLY_PLACE_EXCLUSION =
  "no landmark names, trail names, district labels, or invented place names";

export function promptExclusions(routeOnly: boolean) {
  return routeOnly
    ? [...PROMPT_EXCLUSIONS, ROUTE_ONLY_TEXT_EXCLUSION, ROUTE_ONLY_PLACE_EXCLUSION]
    : [...PROMPT_EXCLUSIONS, NAMED_TEXT_EXCLUSION];
}

/** Locked at the front of every image prompt. The route is the product. */
export const ROUTE_TRACE_RULE =
  "CRITICAL route fidelity: the GPS track on the schematic is exact. Trace that line exactly — every bend, switchback, out-and-back, spur, and crossing — in the same place relative to water, roads, and landmarks. Do not smooth, straighten, simplify, shortcut, or close gaps. Do not omit any segment. Do not invent any segment. Do not snap the path onto a nearby road unless the schematic already shows that. Colored stretches on the schematic are a private name index only: look up the trail name, then discard the color. Paint the whole path as one styled route of even thickness. Route visibility is non-negotiable: it is the primary visual mark and must maintain strong contrast with its immediate background along every segment. Choose its palette color, weight, and surrounding map detail so the complete route is instantly readable; never let water, terrain, roads, textures, or labels make it fade into the background. Title-block safety is non-negotiable: place the title only in unused negative space, never on, over, through, or beyond the route. Do not crop, hide, fade, cut off, or replace any route segment for title text or its panel; if space is tight, move the title block into unused space or its own band instead of shrinking a supplied title or covering the route. Do not copy the schematic's red or named-trail colors, and do not draw a colored stretch thinner or fainter than the rest. Never interrupt the line for a label, icon, or decoration: the route stays continuous and unoccluded; landmarks annotate it, they do not replace it. A prettier wrong path is a failed poster. North is up.";

export const UNANNOTATED_MAP_TRACE_RULE =
  "CRITICAL route fidelity: the GPS track on the schematic is exact. Trace that line exactly — every bend, switchback, out-and-back, spur, and crossing — in the same place relative to water, roads, and land cover. Do not smooth, straighten, simplify, shortcut, or close gaps. Do not omit any segment. Do not invent any segment. Paint the whole path as one styled route of even thickness. Route visibility is non-negotiable: it is the primary visual mark and must maintain strong contrast with its immediate background along every segment. Choose its palette color, weight, and surrounding map detail so the complete route is instantly readable; never let water, terrain, roads, textures, or labels make it fade into the background. Title-block safety is non-negotiable: place the title only in unused negative space, never on, over, through, or beyond the route. Do not crop, hide, fade, cut off, or replace any route segment for title text or its panel; if space is tight, move the title block into unused space or its own band instead of shrinking a supplied title or covering the route. Never interrupt the line for a label, icon, or decoration. Render the visible roads, water, parks, and land-cover shapes from the schematic as a rich unlabeled background map. A prettier wrong path is a failed poster. North is up.";

/**
 * Floor for a title that is still readable when the whole poster image is
 * shown on a phone (about 390px wide), not a zoomed crop. 8% of poster width
 * is about 31px of type at that size.
 */
export const TITLE_CAP_WIDTH_RATIO = 0.08;

export function titleFontSizePx(posterWidthPx: number) {
  return posterWidthPx * TITLE_CAP_WIDTH_RATIO;
}

export const TITLE_PHONE_CLAUSE =
  "Large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 8% of the poster width.";

export const TITLE_PHONE_RULE =
  "Set the title as a large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 8% of the poster width. It is the largest text on the sheet. Wrap a long title instead of shrinking it below that size. Stats and map labels stay smaller. Do not add a title when the design has none.";

const TITLE_PHONE_MARK = /clearly readable when the whole poster is viewed on a phone/i;

export function posterHasTitle(title?: string | null) {
  return Boolean(title?.trim());
}

function joinTitleInstruction(base: string, addition: string) {
  const text = base.trim();
  if (!text) return addition;
  if (TITLE_PHONE_MARK.test(text)) return text;
  return `${text}${/[.!?]$/.test(text) ? " " : ". "}${addition}`;
}

/** Drop title-size language so an untitled design is not prompted to grow a title. */
export function stripTitlePhoneLanguage(value: string) {
  return value
    .replace(TITLE_PHONE_RULE, "")
    .replace(TITLE_PHONE_CLAUSE, "")
    .replace(/^[\s.;,]+|[\s.;,]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function withTitlePhoneClause(value: string, hasTitle: boolean) {
  if (!hasTitle) return stripTitlePhoneLanguage(value);
  return joinTitleInstruction(value, TITLE_PHONE_CLAUSE);
}

export function withTitlePhoneRule(value: string, hasTitle: boolean) {
  if (!hasTitle) return stripTitlePhoneLanguage(value);
  if (TITLE_PHONE_MARK.test(value) && /Do not add a title when the design has none/i.test(value)) {
    return value.trim();
  }
  return joinTitleInstruction(stripTitlePhoneLanguage(value), TITLE_PHONE_RULE);
}

export function titlePromptLine(title: string) {
  const text = title.trim();
  if (!text) return "This design has no title. Do not add one.";
  return `Title, exactly: "${text}". ${TITLE_PHONE_RULE}`;
}

const t = (value?: string) => (value ?? "").trim();

export function isRouteOnlyPoster(spec: PosterSpec) {
  const namedLandmarks = spec.landmarks.some((item) => t(item.name));
  const namedGeography = spec.geography.some((item) => t(item.name));
  return !namedLandmarks && !namedGeography;
}

const sentence = (value: string) => {
  const text = t(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
};
const labeled = (label: string, value: string) => {
  const text = t(value);
  if (!text) return "";
  return `${label}: ${/[.!?]$/.test(text) ? text : `${text}.`}`;
};
const list = (values: string[]) => values.map(t).filter(Boolean);
const paragraph = (parts: string[]) => parts.filter(Boolean).join(" ");

/** Planner copy that tells the image model to keep index numbers or hide names. */
const INDEX_AS_ART =
  /numbered[^.]*discs mark landmarks|represented solely by numbered|numbered circular discs matching|printed landmark text labels/i;

function keepAsPosterInstruction(text: string) {
  return !INDEX_AS_ART.test(text);
}

const TRAIL_STRETCH_SCRUB = new RegExp(
  `\\b(${TRAIL_COLOR_NAMES.join("|")})\\s+stretch of the GPS track[,;]?\\s*`,
  "gi",
);

function scrubIndexLanguage(text: string) {
  return text
    .replace(/Numbered[^.!?\n]*discs mark landmarks\.?/gi, "")
    .replace(/Landmarks are represented solely by numbered[^.!?\n]*\.?/gi, "")
    .replace(TRAIL_STRETCH_SCRUB, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

/**
 * Render a spec as plain prose for the image model. Blank fields and empty
 * arrays are omitted entirely so the model never sees `"palette": []`.
 */
export function specToImagePrompt(spec: PosterSpec): string {
  const sections: string[] = [];
  const routeOnly = isRouteOnlyPoster(spec);

  const lead = scrubIndexLanguage(t(spec.finalPrompt) || fallbackPrompt(spec));
  sections.push(sentence(lead));
  sections.push(routeOnly ? UNANNOTATED_MAP_TRACE_RULE : ROUTE_TRACE_RULE);
  if (routeOnly) {
    sections.push(
      "Use the schematic's roads, water, parks, and land cover as an unlabeled background map. Do not add place names, landmark icons, trail labels, or district labels.",
    );
  }

  const palette = list(spec.style.palette);
  sections.push(
    paragraph([
      labeled("Style", spec.style.name),
      labeled("Medium", spec.style.medium),
      palette.length ? `Palette: ${palette.join(", ")}.` : "",
      labeled("Typography", withTitlePhoneClause(spec.style.typography, posterHasTitle(spec.text.title))),
      labeled("Texture", spec.style.texture),
      labeled("References", spec.style.references),
    ]),
  );

  const decorations = list(spec.composition.decorations);
  sections.push(
    paragraph([
      labeled("Aspect ratio", spec.composition.aspectRatio),
      labeled("Route placement", spec.composition.routePlacement),
      labeled("Title block", withTitlePhoneClause(spec.composition.titleBlock, posterHasTitle(spec.text.title))),
      labeled("Border", spec.composition.border),
      decorations.length ? `Decorations: ${decorations.join(", ")}.` : "",
      "Do not draw a scale bar, graphic scale, or distance ruler — they will not be accurate. Distance belongs only in the title-block stats.",
    ]),
  );

  sections.push(
    paragraph([
      routeLine(spec.route.treatment, spec.route.color),
      markerPrompt(spec.route.startMarker, spec.route.finishMarker, spec.route.startName, spec.route.finishName),
      labeled("Route shape", spec.route.shapeNotes),
    ]),
  );

  const geography = spec.geography
    .map((item) => {
      const head = [t(item.kind), t(item.name)].filter(Boolean).join(" ");
      const treatment = isColoredTrail(item)
        ? posterTrailTreatment()
        : isNamedRegion(item)
          ? posterRegionTreatment()
          : t(item.treatment);
      const tail = [t(item.placement), treatment].filter(Boolean).join("; ");
      if (!head && !tail) return "";
      return tail ? `${head || "feature"} (${tail})` : head;
    })
    .filter(Boolean);
  if (geography.length) {
    const regionNote = spec.geography.some(isNamedRegion)
      ? " CRITICAL region fidelity: each lettered wash on the schematic is the exact footprint of that named district. Draw and write the name across that same area — same place, same extent. Do not drift, slide, shrink, or invent a different region. The ochre is a private index only: look up the letter, then discard both the letter and the ochre. Paint parks and green space green; paint campuses, neighbourhoods, and other districts in the poster palette. Never copy the schematic's brown or ochre wash. Do not draw the letters, a pin, a building icon, or a key."
      : "";
    const trailKey = trailColorKey(spec.geography);
    const regionKey = regionLetterKey(spec.geography);
    sections.push(`Geography: ${geography.join("; ")}.${regionNote}${trailKey}${regionKey}`);
  }

  const landmarks = spec.landmarks
    .filter((item) => t(item.name))
    .map((item, index) => formatLandmarkKeyEntry(item, index));
  if (landmarks.length) {
    sections.push(
      `Landmarks: the numbered discs on the schematic are a private location index. Look up where each place sits, then discard the number. A small marker may sit on the route at that spot. Write each name once, in the poster lettering, beside the marker — offset off the path so the label occludes the route as little as possible. Any icon or illustration sits with the name, off the path, and must stay small. Never cover, break, gap, or replace the route with a label or icon, and never treat an icon as a destination. Do not draw the numbers. Do not add a legend, key, or numbered callouts. ${landmarks.join("; ")}.`,
    );
  }

  const titled = posterHasTitle(spec.text.title);
  const stats = spec.text.stats
    .filter((item) => t(item.value))
    .map((item) => (t(item.label) ? `${t(item.label)} ${t(item.value)}` : t(item.value)));
  sections.push(
    paragraph([
      titlePromptLine(spec.text.title),
      t(spec.text.subtitle) ? `Subtitle, exactly: "${t(spec.text.subtitle)}".` : "",
      stats.length ? `Stats to typeset: ${stats.join(" · ")}.` : "",
      stats.length
        ? "Typeset each stat once. Do not repeat a value in the title block: the distance must not appear as both a large display figure and a labeled line."
        : "",
      labeled("Text rules", withTitlePhoneRule(spec.text.rules, titled)),
    ]),
  );

  const images = spec.grounding.images
    .filter((item) => t(item.role) || t(item.legend))
    .map((item) => `image ${item.index} is the ${t(item.role) || "reference"}${t(item.legend) ? ` (${t(item.legend)})` : ""}`);
  const hasRouteOnly = spec.grounding.images.some((item) => /route-only|silhouette/i.test(item.role));
  const hasSatellite = spec.grounding.images.some((item) => /satellite/i.test(item.role));
  const groundingRules = list(spec.grounding.rules).filter(keepAsPosterInstruction);
  sections.push(
    paragraph([
      images.length ? `Reference images: ${images.join("; ")}.` : "",
      routeOnly
        ? "The schematic is the geographic source of truth. Copy the route shape as a traced original, not an interpretation: same shape, same turns, same position against water, roads, and land cover; north is up. Paint that path as one styled line. Do not copy the schematic's red."
        : "The schematic is the geographic source of truth. Copy the route shape as a traced original, not an interpretation: same shape, same turns, same position against water, roads, and landmarks; north is up. Paint that path as one styled line. Do not copy the schematic's route colors.",
      hasRouteOnly
        ? "The route-only image is the same red GPS track as the schematic, with geography removed. Every separate red stroke on it is a required segment — including lines that run parallel, hug a shore, or almost touch. Do not drop a stroke because water or another part of the route is nearby."
        : "",
      hasSatellite
        ? "The satellite image is real aerial photography of the same frame, with the same red GPS track overlaid. Use it to read land cover, water, vegetation, and built areas, and to confirm every bend, parallel, and shore hug. Every separate red stroke on it is a required segment — including lines that run parallel, hug a shore, or almost touch. Do not drop a stroke because water or another part of the route is nearby. Do not copy the photograph or its colors; keep the poster stylized. The red line is the same exact track as the schematic. If the photograph is surrounded by black, that black is empty margin, not land, water, or sky."
        : "",
      landmarks.length
        ? "The schematic's numbered discs are scaffolding, not artwork. Copy geography and the exact route from the reference; replace every disc with a small on-route marker plus the written name from the landmark list, kept off the path so the route stays visible and continuous."
        : "",
      spec.geography.some(isNamedRegion)
        ? "The schematic's lettered washes are scaffolding, not artwork. Copy each district from that wash: same place, same extent, written name from the geography list. Replace the letter; discard the ochre. Parks stay green; do not paint campuses or neighbourhoods brown because the schematic wash is brown."
        : "",
      groundingRules.length ? `${groundingRules.map(sentence).join(" ")}` : "",
    ]),
  );

  const avoid = Array.from(
    new Set([
      ...list(spec.negative).filter(keepAsPosterInstruction),
      ...promptExclusions(routeOnly),
      ...(posterHasTitle(spec.text.title)
        ? [
            "no caption-sized title",
            "no title too small to read when the whole poster is viewed on a phone",
          ]
        : ["no invented title"]),
    ]),
  );
  sections.push(`Avoid: ${avoid.join("; ")}.`);

  return sections.filter(Boolean).join("\n\n");
}

export function landmarkPin(item: { pin?: number; name?: string }, index: number) {
  return item.pin && item.pin > 0 ? item.pin : index + 1;
}

const NAMED_REGION_KINDS = new Set([
  "neighbourhood",
  "neighborhood",
  "quarter",
  "university",
  "college",
  "campus",
  "park",
  "nature_reserve",
]);

function isNamedRegion(item: PosterSpecGeography) {
  const kind = t(item.kind).toLowerCase();
  if (NAMED_REGION_KINDS.has(kind)) return true;
  return /pale wash|across the (region|district)|not a pin/i.test(item.treatment);
}

function trailColorKey(items: PosterSpecGeography[]) {
  const trails = items.filter(isColoredTrail);
  if (!trails.length) return "";
  const map = trails
    .map((item) => {
      const color = trailColorWord(item);
      return color && t(item.name) ? `${color} = ${t(item.name)}` : "";
    })
    .filter(Boolean);
  if (!map.length) return "";
  return ` Colored stretches of the GPS track are a private trail index, like the numbered discs. Red is unnamed track. Named and unnamed stretches are the same line weight. Look up each color, write that trail name along that stretch, then discard the color. Paint the entire GPS track as one continuous line in the poster route color, same thickness throughout. Never keep the schematic's red or any other index color. Do not draw a color key. ${map.join("; ")}.`;
}

function posterTrailTreatment() {
  return "write the name along that stretch; paint with the poster route color, not the schematic color";
}

function posterRegionTreatment() {
  return "write the name across that same lettered wash; paint for what it is, not schematic ochre; do not draw the letter";
}

function regionLetterKey(items: PosterSpecGeography[]) {
  const regions = items.filter(isNamedRegion);
  if (!regions.length) return "";
  const map = regions
    .map((item) => {
      const letter = t(item.letter);
      return letter && t(item.name) ? `${letter} = ${t(item.name)}` : "";
    })
    .filter(Boolean);
  if (!map.length) return "";
  return ` Letters in the ochre washes are a private region index, like the numbered discs. The wash is the exact area to label — do not move it. Look up each letter, write that name across that same wash, then discard the letter and the ochre color. Do not draw the letters or a key. Do not copy the schematic's brown wash. Parks stay green; other districts use the poster palette. ${map.join("; ")}.`;
}

function isColoredTrail(item: PosterSpecGeography) {
  if (/^trail$/i.test(t(item.kind))) return true;
  return Boolean(t(item.color ?? "")) || /stretch of the GPS track/i.test(item.treatment);
}

function trailColorWord(item: PosterSpecGeography) {
  const explicit = t(item.color ?? "").toLowerCase();
  if (explicit) return explicit;
  const match = /^([a-z]+)\s+stretch of the GPS track/i.exec(t(item.treatment));
  return match?.[1]?.toLowerCase() ?? "";
}

function formatLandmarkKeyEntry(
  item: { name: string; kind?: string; placement?: string; icon?: string; pin?: number },
  index: number,
) {
  const pin = landmarkPin(item, index);
  const notes = [t(item.placement ?? ""), t(item.icon ?? "") ? `icon: ${t(item.icon ?? "")}` : ""]
    .filter(Boolean)
    .join("; ");
  return notes ? `${pin} "${t(item.name)}" (${notes})` : `${pin} "${t(item.name)}"`;
}

function routeLine(treatment: string, color: string) {
  const a = t(treatment);
  const b = t(color);
  if (a && b) return `Route: ${a}, in ${b}.`;
  if (a) return `Route: ${a}.`;
  if (b) return `Route color: ${b}.`;
  return "";
}

function placeNamePrompt(startName?: string, finishName?: string) {
  const start = (startName ?? "").trim();
  const finish = (finishName ?? "").trim();
  if (!start && !finish) return "";
  if (start && (!finish || start.toLowerCase() === finish.toLowerCase())) {
    return `Write "${start}" at the start/finish marker. That marker is a private location index; the schematic has no start/finish text. Do not put this name in the title block.`;
  }
  if (start && finish) {
    return `Write "${start}" at the start marker and "${finish}" at the finish marker. Those markers are a private location index; the schematic has no start/finish text. These names sit on the map, not in the title block.`;
  }
  return `Write "${finish}" at the finish marker. That marker is a private location index; the schematic has no start/finish text. Do not put this name in the title block.`;
}

function markerPrompt(start: string, finish: string, startName?: string, finishName?: string) {
  const startMark = start.trim();
  const finishMark = finish.trim();
  const blank = (value: string) => !value || /^none$/i.test(value);
  const marks =
    blank(startMark) && blank(finishMark)
      ? ""
      : startMark && finishMark && startMark.toLowerCase() === finishMark.toLowerCase()
        ? `Marker: ${startMark}.`
        : [startMark && `Start marker: ${startMark}.`, finishMark && `Finish marker: ${finishMark}.`]
            .filter(Boolean)
            .join(" ");
  return [marks, placeNamePrompt(startName, finishName)].filter(Boolean).join(" ");
}

function fallbackPrompt(spec: PosterSpec): string {
  const landmarks = spec.landmarks
    .filter((item) => t(item.name))
    .map((item, index) => formatLandmarkKeyEntry(item, index))
    .join("; ");
  const palette = list(spec.style.palette);
  return [
    `Create a ${t(spec.style.name) || "stylized"} map poster.`,
    sentence(spec.style.medium),
    palette.length ? `Palette: ${palette.join(", ")}.` : "",
    routeLine(spec.route.treatment, spec.route.color),
    markerPrompt(spec.route.startMarker, spec.route.finishMarker, spec.route.startName, spec.route.finishName),
    landmarks
      ? `Landmarks: ${landmarks}. A small marker may sit on the route at each index location; write each name and any icon beside the path so they occlude it as little as possible. Do not draw the numbers or a legend.`
      : isRouteOnlyPoster(spec)
        ? "Render the schematic's roads, water, parks, and land cover as an unlabeled background map."
        : "",
    posterHasTitle(spec.text.title)
      ? `Title exactly "${t(spec.text.title)}". ${TITLE_PHONE_RULE}`
      : "This design has no title. Do not add one.",
    t(spec.text.subtitle) ? `Subtitle exactly "${t(spec.text.subtitle)}".` : "",
    "North is up. Trace the schematic route exactly. Do not invent, omit, or simplify any part of the path.",
  ]
    .filter(Boolean)
    .join(" ");
}
