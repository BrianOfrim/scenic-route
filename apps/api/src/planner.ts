import type { PosterPoi } from "./osm/features";
import { chatJson } from "./openrouter";
import { validatePosterSpec, type PosterSpec } from "./posterSpec";

export type PlannerInput = {
  activity: {
    name?: string;
    sportType?: string;
    isLoop?: boolean;
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
        "The attached grounding images (described by index and role) are the geographic source of truth.",
        "Keep the route shape, orientation, and relative placement of water, roads, and landmarks truthful.",
        "Do not invent place names. Use exact spelling from the supplied landmarks and stats.",
        "North is up. The route is the hero. Leave a title block for the supplied text.",
        "finalPrompt should be a complete image-generation prompt that restates style, geography, landmarks, text, and grounding rules.",
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
  return { spec: validatePosterSpec(value), cost };
}
