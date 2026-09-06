import type { PosterPoi } from "./osm/features";
import { chatJson } from "./openrouter";
import { validatePosterSpec, type PosterSpec } from "./posterSpec";

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

export function buildPlannerMessages(input: PlannerInput) {
  const landmarks = input.pois.map((poi) => ({
    name: poi.name,
    kind: poi.kind,
    placement: `${poi.xy.region}, ${poi.bearing} of the route, about ${(poi.distToRouteM / 1000).toFixed(2)} km from the line at ${(poi.routeFrac * 100).toFixed(0)}% along`,
    lat: poi.lat,
    lng: poi.lng,
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
        "Keep field values concise. Skip or keep finalPrompt short; a complete image prompt is assembled from the structured fields.",
        "The attached grounding images (described by index and role) are the geographic source of truth.",
        "Keep the route shape, orientation, and relative placement of water, roads, and landmarks truthful.",
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

export async function planPoster(input: PlannerInput): Promise<{ spec: PosterSpec; cost: number | null }> {
  const { value, cost } = await chatJson<unknown>({
    messages: buildPlannerMessages(input),
    schemaName: "poster_spec",
    label: "plan",
  });
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = record.text && typeof record.text === "object" && !Array.isArray(record.text)
    ? (record.text as Record<string, unknown>)
    : {};
  const title = typeof text.title === "string" && text.title.trim() ? text.title : input.title;
  return { spec: validatePosterSpec({ ...record, text: { ...text, title } }), cost };
}
