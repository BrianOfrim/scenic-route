import type { PosterPoi } from "./osm/features";
import { chatJson } from "./openrouter";
import { POSTER_SPEC_SCHEMA, validatePosterSpec, type PosterSpec } from "./posterSpec";

export type PlannerInput = {
  activity: {
    name?: string;
    sportType?: string;
    isLoop?: boolean;
  };
  routeMarkers?: {
    enabled: boolean;
    mode: "loop" | "start-finish";
  };
  title: string;
  subtitle: string;
  stats: Array<{ label: string; value: string }>;
  style: {
    id: string;
    label: string;
    prompt: string;
    palette?: string[];
    typography?: string;
  };
  customStylePrompt?: string;
  aspectRatio: string;
  geography: Array<{ id: string; label: string }>;
  pois: PosterPoi[];
  grounding: Array<{ index: number; role: string; legend: string }>;
  refineNotes?: string;
  previousSpec?: PosterSpec;
};

/**
 * A compact skeleton of the required output. Models that ignore the strict
 * response schema still tend to copy the shape they are shown.
 */
export const POSTER_SPEC_SHAPE = {
  style: { name: "", medium: "", palette: [""], typography: "", texture: "", references: "" },
  composition: { aspectRatio: "2:3", routePlacement: "", titleBlock: "", border: "", decorations: [""] },
  route: { treatment: "", color: "", startMarker: "", finishMarker: "", shapeNotes: "" },
  geography: [{ kind: "", name: "", placement: "", treatment: "" }],
  landmarks: [{ name: "", kind: "", placement: "", icon: "", pin: 1 }],
  text: { title: "", subtitle: "", stats: [{ label: "", value: "" }], rules: "" },
  grounding: { images: [{ index: 1, role: "", legend: "" }], rules: [""] },
  negative: [""],
  finalPrompt: "",
} as const;

export function proximityWord(distToRouteM: number): string {
  if (distToRouteM <= 60) return "on the route";
  if (distToRouteM <= 300) return "just off the route";
  if (distToRouteM <= 1500) return "a short way from the route";
  return "well away from the route";
}

export function buildPlannerMessages(input: PlannerInput) {
  // Coarse verbal placement only: image models place labels by region, and the
  // planner tends to echo whatever phrase it is given straight into the prompt.
  const landmarks = input.pois.map((poi, index) => ({
    pin: index + 1,
    name: poi.name,
    kind: poi.kind,
    placement: `${poi.xy.region}, ${poi.bearing} of the route`,
    proximity: proximityWord(poi.distToRouteM),
    routeProgressPct: Math.round(poi.routeFrac * 100),
  }));
  const user = {
    title: input.title,
    subtitle: input.subtitle,
    stats: input.stats,
    activity: input.activity,
    routeMarkers: input.routeMarkers ?? null,
    stylePreset: input.style,
    customStylePrompt: input.customStylePrompt?.trim() || null,
    aspectRatio: input.aspectRatio,
    geographyLayers: input.geography,
    landmarks,
    groundingImages: input.grounding,
    refineNotes: input.refineNotes?.trim() || null,
    previousSpec: input.previousSpec ?? null,
  };
  return [
    {
      role: "system",
      content: [
        "You write structured prompts for a map-poster image model.",
        "Reply with a single JSON object using keys style, composition, route, geography, landmarks, text, grounding, negative, and optional finalPrompt.",
        `Every value must follow this exact shape (nested objects and arrays, never a prose string in place of an object): ${JSON.stringify(POSTER_SPEC_SHAPE)}`,
        "Fill style.name, style.medium, style.palette, style.typography, composition.routePlacement, composition.titleBlock, route.treatment, and route.color with concrete choices; do not leave them blank.",
        "Copy title, subtitle, stats, and groundingImages from the input into text and grounding verbatim.",
        "Landmarks: one entry per supplied landmark, exact spelling, pin copied from the list so the image prompt can look up locations. The schematic uses numbered discs as a private index only. The finished poster must write each landmark name on the map at that disc and must never copy the numbers or add a number-to-name legend. Do not describe numbered discs as a poster feature. Do not forbid printed landmark names. placement copied as the short phrase given (e.g. 'upper-left, west of the route'); do not add distances or percentages.",
        "Keep field values concise. Skip or keep finalPrompt short; a complete image prompt is assembled from the structured fields.",
        "The attached grounding images (described by index and role) are the geographic source of truth.",
        "The red line on the schematic is the exact GPS track. If a route-only image is attached, it is that same red line with geography removed; every separate stroke on it is a required segment, including parallels and shore hugs. The finished poster must reproduce that path exactly: every bend, switchback, out-and-back, and crossing, in the same place relative to water, roads, and landmarks.",
        "Never write route.shapeNotes or finalPrompt that describe a different, simpler, or idealized path. Style the line; do not redesign it.",
        "Do not invent place names. Use exact spelling from the supplied landmarks and stats.",
        "North is up. The route is the hero. Leave a title block for the supplied text.",
        "Honor routeMarkers. If enabled is false, startMarker and finishMarker must be none — do not draw start or finish symbols.",
        "If routeMarkers.mode is loop, start and finish are the same place: use one combined start/finish marker, not two.",
        "If routeMarkers.mode is start-finish, use distinct start and finish markers.",
        "If refineNotes or previousSpec are present, evolve that spec rather than starting over.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(user, null, 2),
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  const text = str(value);
  if (!text) return [];
  return text
    .split(/[;\n]|,\s(?=[A-Za-z])/)
    .map((part) => part.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean);
}

/** "Castle Mountain — peak, upper-right" | "Castle Mountain (upper-right)" | "Castle Mountain: upper-right" */
function assignLandmarkPins(landmarks: unknown[], pois: PlannerInput["pois"]) {
  const rows = landmarks.filter(isRecord);
  const pinByName = new Map(pois.map((poi, index) => [poi.name.trim().toLowerCase(), index + 1]));
  return rows.map((item, index) => ({
    ...item,
    pin: pinByName.get(str(item.name).toLowerCase()) ?? (Number(item.pin) > 0 ? Math.round(Number(item.pin)) : index + 1),
  }));
}

function landmarkFromText(text: string): { name: string; kind: string; placement: string; icon: string; pin: number } {
  const match = /^(?:\d+[\.)]\s*)?(.*?)\s*(?:[—–:-]\s*|\()(.*?)\)?$/.exec(text.trim());
  if (!match || !match[2]) return { name: text.trim(), kind: "", placement: "", icon: "", pin: 0 };
  return { name: match[1].trim(), kind: "", placement: match[2].trim(), icon: "", pin: 0 };
}

/**
 * Coerce planner output that used prose strings where the schema wants
 * objects, and fill fields the planner is only meant to copy from the input.
 * Runs before validation so fewer fields collapse to empty.
 */
export function repairPlannerOutput(raw: unknown, input: PlannerInput): Record<string, unknown> {
  const record: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};

  if (!isRecord(record.style)) {
    record.style = { medium: str(record.style) };
  }
  const style = { ...(record.style as Record<string, unknown>) };
  if (!str(style.name)) style.name = input.style.label;
  if (!Array.isArray(style.palette) || !style.palette.length) {
    const parsed = splitList(style.palette);
    style.palette = parsed.length ? parsed : input.style.palette ?? [];
  }
  if (!str(style.typography) && input.style.typography) style.typography = input.style.typography;
  if (!str(style.medium) && !str(style.references)) {
    style.references = [input.style.prompt, input.customStylePrompt?.trim()].filter(Boolean).join(" ");
  }
  record.style = style;

  if (!isRecord(record.composition)) {
    record.composition = { routePlacement: str(record.composition) };
  }
  const composition = { ...(record.composition as Record<string, unknown>) };
  if (!str(composition.aspectRatio)) composition.aspectRatio = input.aspectRatio;
  if (!Array.isArray(composition.decorations)) composition.decorations = splitList(composition.decorations);
  record.composition = composition;

  if (!isRecord(record.route)) {
    record.route = { treatment: str(record.route) };
  }
  const route = { ...(record.route as Record<string, unknown>) };
  if (input.routeMarkers && !input.routeMarkers.enabled) {
    route.startMarker = "none";
    route.finishMarker = "none";
  }
  record.route = route;

  if (!Array.isArray(record.geography)) {
    record.geography = splitList(record.geography).map((treatment) => ({
      kind: "geography",
      name: "",
      placement: "",
      treatment,
    }));
  }

  if (!Array.isArray(record.landmarks)) {
    record.landmarks = splitList(record.landmarks).map(landmarkFromText);
  } else {
    record.landmarks = record.landmarks.map((item) => (typeof item === "string" ? landmarkFromText(item) : item));
  }
  record.landmarks = assignLandmarkPins(
    Array.isArray(record.landmarks) ? record.landmarks : [],
    input.pois,
  );

  const text: Record<string, unknown> = isRecord(record.text) ? { ...record.text } : { rules: str(record.text) };
  if (!str(text.title)) text.title = input.title;
  if (!str(text.subtitle)) text.subtitle = input.subtitle;
  if (!Array.isArray(text.stats) || !text.stats.length) text.stats = input.stats;
  record.text = text;

  const grounding: Record<string, unknown> = isRecord(record.grounding)
    ? { ...record.grounding }
    : { rules: splitList(record.grounding) };
  if (!Array.isArray(grounding.images) || !grounding.images.length) grounding.images = input.grounding;
  if (!Array.isArray(grounding.rules)) grounding.rules = splitList(grounding.rules);
  record.grounding = grounding;

  if (!Array.isArray(record.negative)) record.negative = splitList(record.negative);

  return record;
}

/**
 * A spec is usable when the image model would receive at least a style
 * direction and a route treatment. Anything less is a failed plan, not a
 * plan with gaps to paper over.
 */
export function assertUsableSpec(spec: PosterSpec) {
  const hasStyle = Boolean(spec.style.medium.trim() || spec.style.references.trim() || spec.style.name.trim());
  const hasRoute = Boolean(spec.route.treatment.trim() || spec.route.color.trim());
  if (!hasStyle || !hasRoute) {
    throw new Error("Planner returned an unusable spec (no style or route direction). Try again or switch OPENROUTER_MODEL.");
  }
}

export async function planPoster(input: PlannerInput): Promise<{ spec: PosterSpec; cost: number | null }> {
  const { value, cost } = await chatJson<unknown>({
    messages: buildPlannerMessages(input),
    schemaName: "poster_spec",
    schema: POSTER_SPEC_SCHEMA,
    label: "plan",
  });
  const spec = validatePosterSpec(repairPlannerOutput(value, input));
  assertUsableSpec(spec);
  return { spec, cost };
}
