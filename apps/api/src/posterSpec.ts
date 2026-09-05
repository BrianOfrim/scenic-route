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
        required: ["name", "kind", "placement", "icon"],
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          placement: { type: "string" },
          icon: { type: "string" },
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
      ? raw.landmarks.filter(isRecord).map((item) => ({
          name: asString(item.name),
          kind: asString(item.kind),
          placement: asString(item.placement),
          icon: asString(item.icon),
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

export function specToImagePrompt(spec: PosterSpec): string {
  return `${spec.finalPrompt.trim()}\n\nSPEC (JSON):\n${JSON.stringify(spec, null, 2)}`;
}

function fallbackPrompt(spec: PosterSpec): string {
  const landmarks = spec.landmarks.map((item) => `${item.name} (${item.placement})`).join("; ");
  return [
    `Create a ${spec.style.name || "stylized"} map poster.`,
    spec.style.medium,
    `Palette: ${spec.style.palette.join(", ")}.`,
    `Route: ${spec.route.treatment} in ${spec.route.color}.`,
    landmarks ? `Label: ${landmarks}.` : "",
    `Title exactly "${spec.text.title}". Subtitle exactly "${spec.text.subtitle}".`,
    "North is up. Follow the grounding images for geography. Do not invent a different path.",
  ]
    .filter(Boolean)
    .join(" ");
}
