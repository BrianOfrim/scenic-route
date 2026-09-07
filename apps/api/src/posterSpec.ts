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
  shapeNotes: string;
};

export type PosterSpecGeography = {
  kind: string;
  name: string;
  placement: string;
  treatment: string;
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
      required: ["treatment", "color", "startMarker", "finishMarker", "shapeNotes"],
      properties: {
        treatment: { type: "string" },
        color: { type: "string" },
        startMarker: { type: "string" },
        finishMarker: { type: "string" },
        shapeNotes: { type: "string" },
      },
    },
    geography: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "name", "placement", "treatment"],
        properties: {
          kind: { type: "string" },
          name: { type: "string" },
          placement: { type: "string" },
          treatment: { type: "string" },
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
      aspectRatio: asString(composition.aspectRatio, "2:3"),
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
      shapeNotes: asString(route.shapeNotes),
    },
    geography: Array.isArray(raw.geography)
      ? raw.geography.filter(isRecord).map((item) => ({
          kind: asString(item.kind),
          name: asString(item.name),
          placement: asString(item.placement),
          treatment: asString(item.treatment),
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
  "no numbered landmark discs, pin numbers, or numbered callouts",
  "no latitude/longitude numbers, coordinates, or grid lines",
  "no watermark",
  "no text other than the title block and the listed landmark names",
  "no different route than the red line on the schematic",
  "no smoothed, straightened, shortcut, or invented path",
  "no omitted out-and-backs, spurs, or crossings",
];

/** Locked at the front of every image prompt. The route is the product. */
export const ROUTE_TRACE_RULE =
  "CRITICAL route fidelity: the red line on the schematic is the exact GPS track. Trace it exactly — every bend, switchback, out-and-back, spur, and crossing — in the same place relative to water, roads, and landmarks. Do not smooth, straighten, simplify, shortcut, or close gaps. Do not omit any segment. Do not invent any segment. Do not snap the path onto a nearby road unless the schematic already shows that. A prettier wrong path is a failed poster. North is up.";

const t = (value: string) => value.trim();
const sentence = (value: string) => {
  const text = t(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
};
const labeled = (label: string, value: string) => (t(value) ? `${label}: ${t(value)}.` : "");
const list = (values: string[]) => values.map(t).filter(Boolean);
const paragraph = (parts: string[]) => parts.filter(Boolean).join(" ");

/** Planner copy that tells the image model to keep index numbers or hide names. */
const INDEX_AS_ART =
  /numbered[^.]*discs mark landmarks|represented solely by numbered|numbered circular discs matching|printed landmark text labels/i;

function keepAsPosterInstruction(text: string) {
  return !INDEX_AS_ART.test(text);
}

function scrubIndexLanguage(text: string) {
  return text
    .replace(/Numbered[^.!?\n]*discs mark landmarks\.?/gi, "")
    .replace(/Landmarks are represented solely by numbered[^.!?\n]*\.?/gi, "")
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

  const lead = scrubIndexLanguage(t(spec.finalPrompt) || fallbackPrompt(spec));
  sections.push(sentence(lead));
  sections.push(ROUTE_TRACE_RULE);

  const palette = list(spec.style.palette);
  sections.push(
    paragraph([
      labeled("Style", spec.style.name),
      labeled("Medium", spec.style.medium),
      palette.length ? `Palette: ${palette.join(", ")}.` : "",
      labeled("Typography", spec.style.typography),
      labeled("Texture", spec.style.texture),
      labeled("References", spec.style.references),
    ]),
  );

  const decorations = list(spec.composition.decorations);
  sections.push(
    paragraph([
      labeled("Aspect ratio", spec.composition.aspectRatio),
      labeled("Route placement", spec.composition.routePlacement),
      labeled("Title block", spec.composition.titleBlock),
      labeled("Border", spec.composition.border),
      decorations.length ? `Decorations: ${decorations.join(", ")}.` : "",
    ]),
  );

  sections.push(
    paragraph([
      routeLine(spec.route.treatment, spec.route.color),
      markerPrompt(spec.route.startMarker, spec.route.finishMarker),
      labeled("Route shape", spec.route.shapeNotes),
    ]),
  );

  const geography = spec.geography
    .map((item) => {
      const head = [t(item.kind), t(item.name)].filter(Boolean).join(" ");
      const tail = [t(item.placement), t(item.treatment)].filter(Boolean).join("; ");
      if (!head && !tail) return "";
      return tail ? `${head || "feature"} (${tail})` : head;
    })
    .filter(Boolean);
  if (geography.length) sections.push(`Geography: ${geography.join("; ")}.`);

  const landmarks = spec.landmarks
    .filter((item) => t(item.name))
    .map((item, index) => formatLandmarkKeyEntry(item, index));
  if (landmarks.length) {
    sections.push(
      `Landmarks: the numbered discs on the schematic are a private location index. Look up where each place sits, then discard the number. Write each name once, in the poster lettering, directly on the map at that spot. Place any illustration or icon at the same spot as the name. Do not draw the numbers. Do not add a legend, key, or numbered callouts. ${landmarks.join("; ")}.`,
    );
  }

  const stats = spec.text.stats
    .filter((item) => t(item.value))
    .map((item) => (t(item.label) ? `${t(item.label)} ${t(item.value)}` : t(item.value)));
  sections.push(
    paragraph([
      `Title, exactly: "${t(spec.text.title)}".`,
      t(spec.text.subtitle) ? `Subtitle, exactly: "${t(spec.text.subtitle)}".` : "",
      stats.length ? `Stats to typeset: ${stats.join(" · ")}.` : "",
      labeled("Text rules", spec.text.rules),
    ]),
  );

  const images = spec.grounding.images
    .filter((item) => t(item.role) || t(item.legend))
    .map((item) => `image ${item.index} is the ${t(item.role) || "reference"}${t(item.legend) ? ` (${t(item.legend)})` : ""}`);
  const hasRouteOnly = spec.grounding.images.some((item) => /route-only|silhouette/i.test(item.role));
  const groundingRules = list(spec.grounding.rules).filter(keepAsPosterInstruction);
  sections.push(
    paragraph([
      images.length ? `Reference images: ${images.join("; ")}.` : "",
      "The schematic is the geographic source of truth. Copy the red route as a traced original, not an interpretation: same shape, same turns, same position against water, roads, and landmarks; north is up.",
      hasRouteOnly
        ? "The route-only image is the same red GPS track as the schematic, with geography removed. Every separate red stroke on it is a required segment — including lines that run parallel, hug a shore, or almost touch. Do not drop a stroke because water or another part of the route is nearby."
        : "",
      landmarks.length
        ? "The schematic's numbered discs are scaffolding, not artwork. Copy geography and the exact route from the reference; replace every disc with the written name from the landmark list."
        : "",
      groundingRules.length ? `${groundingRules.map(sentence).join(" ")}` : "",
    ]),
  );

  const avoid = Array.from(new Set([...list(spec.negative).filter(keepAsPosterInstruction), ...PROMPT_EXCLUSIONS]));
  sections.push(`Avoid: ${avoid.join("; ")}.`);

  return sections.filter(Boolean).join("\n\n");
}

export function landmarkPin(item: { pin?: number; name?: string }, index: number) {
  return item.pin && item.pin > 0 ? item.pin : index + 1;
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

function markerPrompt(start: string, finish: string) {
  const startMark = start.trim();
  const finishMark = finish.trim();
  const blank = (value: string) => !value || /^none$/i.test(value);
  if (blank(startMark) && blank(finishMark)) return "";
  if (startMark && finishMark && startMark.toLowerCase() === finishMark.toLowerCase()) {
    return `Marker: ${startMark}.`;
  }
  return [startMark && `Start marker: ${startMark}.`, finishMark && `Finish marker: ${finishMark}.`]
    .filter(Boolean)
    .join(" ");
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
    markerPrompt(spec.route.startMarker, spec.route.finishMarker),
    landmarks
      ? `Landmarks: ${landmarks}. Write each name on the map at its index location; do not draw the numbers or a legend.`
      : "",
    `Title exactly "${t(spec.text.title)}".`,
    t(spec.text.subtitle) ? `Subtitle exactly "${t(spec.text.subtitle)}".` : "",
    "North is up. Trace the schematic route exactly. Do not invent, omit, or simplify any part of the path.",
  ]
    .filter(Boolean)
    .join(" ");
}
