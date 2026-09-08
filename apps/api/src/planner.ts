import { areaLetter } from "./areaLetters";
import type { NamedArea, NamedWay, PosterPoi } from "./osm/features";
import { chatJson } from "./openrouter";
import { POSTER_SPEC_SCHEMA, validatePosterSpec, type PosterSpec } from "./posterSpec";
import { TRAIL_TREATMENT, trailColorName } from "./trailColors";

export type PlannerInput = {
  activity: {
    name?: string;
    sportType?: string;
    isLoop?: boolean;
  };
  routeMarkers?: {
    enabled: boolean;
    mode: "loop" | "start-finish";
    startName?: string;
    finishName?: string;
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
  namedWays?: NamedWay[];
  namedAreas?: NamedArea[];
  grounding: Array<{ index: number; role: string; legend: string }>;
  refineNotes?: string;
  previousSpec?: PosterSpec;
};

const REGION_TREATMENT =
  "write the name across that district in the same place as the schematic letter; paint for what it is, not schematic ochre; not a pin";

/**
 * A compact skeleton of the required output. Models that ignore the strict
 * response schema still tend to copy the shape they are shown.
 */
export const POSTER_SPEC_SHAPE = {
  style: { name: "", medium: "", palette: [""], typography: "", texture: "", references: "" },
  composition: { aspectRatio: "2:3", routePlacement: "", titleBlock: "", border: "", decorations: [""] },
  route: { treatment: "", color: "", startMarker: "", finishMarker: "", startName: "", finishName: "", shapeNotes: "" },
  geography: [{ kind: "", name: "", placement: "", treatment: "", color: "", letter: "" }],
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
    placement: poi.inside
      ? `${poi.xy.region}, ${poi.bearing} of the route, inside ${poi.inside}`
      : `${poi.xy.region}, ${poi.bearing} of the route`,
    proximity: proximityWord(poi.distToRouteM),
    routeProgressPct: Math.round(poi.routeFrac * 100),
  }));
  const namedTrails = (input.namedWays ?? []).map((way, index) => {
    const color = trailColorName(index, way.colorName);
    return {
      name: way.name,
      kind: way.kind,
      color,
      placement: `${way.xy.region}, ${way.bearing} of the route`,
      proximity: proximityWord(way.distToRouteM),
      routeProgressPct: Math.round(way.routeFrac * 100),
      treatment: TRAIL_TREATMENT,
    };
  });
  const namedRegions = (input.namedAreas ?? []).map((area, index) => ({
    name: area.name,
    kind: area.kind,
    letter: area.letter || areaLetter(index),
    placement: `${area.xy.region}, ${area.bearing} of the route`,
    proximity: proximityWord(area.distToRouteM),
    routeProgressPct: Math.round(area.routeFrac * 100),
    treatment: REGION_TREATMENT,
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
    namedTrails,
    namedRegions,
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
        "Landmarks: one entry per supplied landmark, exact spelling, pin copied from the list so the image prompt can look up locations. The schematic uses numbered discs as a private index only. The finished poster may put a small marker on the route at that disc. Landmark names and icons sit beside the path, not on it, and must never occlude, break, or replace the route. Do not describe large pictorial icons as sitting on the GPS track. The finished poster must write each landmark name on the map near that disc and must never copy the numbers or add a number-to-name legend. Do not describe numbered discs as a poster feature. Do not forbid printed landmark names. placement copied as the short phrase given (e.g. 'upper-left, west of the route'); do not add distances or percentages.",
        "Named trails recolor stretches of the GPS track on the schematic only, as a private name index. They are not separate lines and have no text on the schematic. Put each supplied namedTrails entry in geography as a named path. Copy color as the index word only. Treatment is write the name along that stretch — never 'teal stretch' or any colored-track phrase. The finished poster must write each trail name along that stretch and paint the whole GPS track as one line in route.color — never in the schematic trail colors. route.treatment and route.color describe one continuous poster path; do not describe a multi-colored track. Do not invent extra trails, treat trail names as point landmarks, or tell the image model to draw a color key.",
        "Named regions are pale ochre washes on the schematic with a letter as a private name index, not discs. The lettered wash is the exact footprint: put each supplied namedRegions entry in geography as a labeled district and tell the image model to draw and label that district in the same place and extent as the wash. Do not drift, slide, or invent a different area. Copy letter as the index character only. The ochre color is index scaffolding, like trail colors — look up the name, then discard the letter and the ochre. Paint each region for what it is: parks and green space as green; campuses, neighbourhoods, and other districts in the poster palette. Never copy the schematic's brown or ochre wash. The finished poster must write each region name across that wash and must never copy the letters or add a letter-to-name key. Do not invent extra districts or treat region names as point landmarks.",
        "If a landmark placement already says inside a region, keep that one clause. Do not nest further. Neighbourhood, campus, and park landmarks that are still in the landmark list have no region wash: write them as district labels, not building icons.",
        "Keep field values concise. Skip or keep finalPrompt short; a complete image prompt is assembled from the structured fields.",
        "The attached grounding images (described by index and role) are the geographic source of truth.",
        "The GPS track on the schematic is exact. Colored stretches identify named trails for lookup only. If a route-only image is attached, it is that same track in red only, with geography removed; every separate stroke on it is a required segment, including parallels and shore hugs. The finished poster must reproduce that path shape exactly: every bend, switchback, out-and-back, and crossing, in the same place relative to water, roads, and landmarks. Style the line as one color; do not copy the schematic's route colors.",
        "Never write route.shapeNotes or finalPrompt that describe a different, simpler, or idealized path, or that tell the image model to keep the schematic's route colors. Style the line; do not redesign it.",
        "Do not invent place names. Use exact spelling from the supplied landmarks, stats, and routeMarkers names.",
        "North is up. The route is the hero. Leave a title block for the supplied text.",
        "Honor routeMarkers. If enabled is false, startMarker and finishMarker must be none — do not draw start or finish symbols.",
        "If routeMarkers.mode is loop, start and finish are the same place: use one combined start/finish marker, not two.",
        "If routeMarkers.mode is start-finish, use distinct start and finish markers.",
        "If routeMarkers.startName or finishName are supplied, copy them onto route.startName and route.finishName. The finished poster must write those names at the schematic start/finish marker(s). The schematic has no start/finish text — the marker is the location index. If both names match or mode is loop, write one name at the combined marker. These names are map labels, not title-block stats.",
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
function ensureNamedTrails(geography: unknown[], ways: NamedWay[]) {
  if (!ways.length) return geography;
  const byName = new Map(
    ways.map((way, index) => [way.name.toLowerCase(), { way, color: trailColorName(index, way.colorName) }]),
  );
  const rows = geography.filter(isRecord).map((item) => {
    const hit = byName.get(str(item.name).toLowerCase());
    if (!hit) return item;
    return {
      ...item,
      kind: str(item.kind) || hit.way.kind || "trail",
      color: str(item.color) || hit.color,
      treatment: stripLegacyTrailTreatment(str(item.treatment)),
    };
  });
  const existing = new Set(rows.map((item) => str(item.name).toLowerCase()).filter(Boolean));
  const extras = ways.flatMap((way, index) => {
    if (existing.has(way.name.toLowerCase())) return [];
    return [
      {
        kind: way.kind || "trail",
        name: way.name,
        placement: `${way.xy.region}, ${way.bearing} of the route`,
        color: trailColorName(index, way.colorName),
        treatment: TRAIL_TREATMENT,
      },
    ];
  });
  return extras.length ? [...rows, ...extras] : rows;
}

function stripLegacyTrailTreatment(treatment: string) {
  if (/stretch of the GPS track/i.test(treatment)) return TRAIL_TREATMENT;
  return treatment || TRAIL_TREATMENT;
}

function ensureNamedRegions(geography: unknown[], areas: NamedArea[]) {
  if (!areas.length) return geography;
  const byName = new Map(
    areas.map((area, index) => [area.name.toLowerCase(), { area, letter: area.letter || areaLetter(index) }]),
  );
  const rows = geography.filter(isRecord).map((item) => {
    const hit = byName.get(str(item.name).toLowerCase());
    if (!hit) return item;
    return {
      ...item,
      kind: str(item.kind) || hit.area.kind,
      letter: str(item.letter) || hit.letter,
      treatment: str(item.treatment) || REGION_TREATMENT,
    };
  });
  const existing = new Set(rows.map((item) => str(item.name).toLowerCase()).filter(Boolean));
  const extras = areas.flatMap((area, index) => {
    if (existing.has(area.name.toLowerCase())) return [];
    return [
      {
        kind: area.kind,
        name: area.name,
        placement: `${area.xy.region}, ${area.bearing} of the route`,
        letter: area.letter || areaLetter(index),
        treatment: REGION_TREATMENT,
      },
    ];
  });
  return extras.length ? [...rows, ...extras] : rows;
}

function dropRegionLandmarks(landmarks: unknown[], areas: NamedArea[]) {
  if (!areas.length) return landmarks;
  const names = new Set(areas.map((area) => area.name.toLowerCase()));
  return landmarks.filter((item) => !names.has(str(isRecord(item) ? item.name : item).toLowerCase()));
}

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
  if (input.routeMarkers) {
    route.startName = (input.routeMarkers.startName ?? "").trim();
    route.finishName = (input.routeMarkers.finishName ?? "").trim();
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
  record.geography = ensureNamedTrails(
    ensureNamedRegions(
      Array.isArray(record.geography) ? record.geography : [],
      input.namedAreas ?? [],
    ),
    input.namedWays ?? [],
  );

  if (!Array.isArray(record.landmarks)) {
    record.landmarks = splitList(record.landmarks).map(landmarkFromText);
  } else {
    record.landmarks = record.landmarks.map((item) => (typeof item === "string" ? landmarkFromText(item) : item));
  }
  record.landmarks = assignLandmarkPins(
    dropRegionLandmarks(Array.isArray(record.landmarks) ? record.landmarks : [], input.namedAreas ?? []),
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
