import type { NamedArea, NamedWay, PosterPoi } from "./osm/features";
import { peopleStatValue } from "./people";
import { resolveReferences } from "./referenceUploads";
import { imageAspectRatio, initialImagePrompt, validatePosterSpec, type PosterSpec } from "./posterSpec";

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
  /** People who did the activity. Printed once in the title block, never as map labels. */
  people?: string[];
  style: {
    id: string;
    label: string;
    prompt: string;
    palette?: string[];
    typography?: string;
    openPalette?: boolean;
  };
  customStylePrompt?: string;
  /** Rider's note about the day — season, weather, light, foliage. Flavours the image prompt. */
  vibes?: string;
  aspectRatio: string;
  geography: Array<{ id: string; label: string }>;
  pois: PosterPoi[];
  namedWays?: NamedWay[];
  namedAreas?: NamedArea[];
  referenceBatchId?: string;
  grounding: Array<{ index: number; role: string; legend: string; dataUrl?: string; url?: string }>;
  /** Accepted for old clients; fresh templates never reuse planner decisions or edit notes. */
  refineNotes?: string;
  previousSpec?: PosterSpec;
  /** No landmarks, trail names, or named districts — geography layers may still be included. */
  routeOnly?: boolean;
};

/** Collapse a rider's day note into a single prompt-sized line. */
export function normalizeVibes(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Pure preparation: the image model makes aesthetic decisions from these inputs. */
export function buildInitialPoster(input: PlannerInput): { spec: PosterSpec; cost: 0; model?: string } {
  if (!input?.style?.id || !input.style.prompt?.trim()) throw new Error("a style and style description are required");
  if (!Array.isArray(input.grounding) || !input.grounding.length) throw new Error("at least one grounding image is required");
  if (input.grounding.some((ref, index) => ref.index !== index + 1 || !ref.role?.trim())) {
    throw new Error("reference metadata must use ordered image indices and roles");
  }
  const markers = input.routeMarkers ?? { enabled: true, mode: input.activity?.isLoop ? "loop" : "start-finish" };
  const people = peopleStatValue(input.people);
  const styleText = [...new Set([input.style.prompt.trim(), input.customStylePrompt?.trim()].filter(Boolean))].join(" ");
  const spec = validatePosterSpec({
    promptTemplateVersion: 1,
    style: {
      name: input.style.label, references: styleText,
      palette: input.style.openPalette ? [] : input.style.palette ?? [],
      typography: input.style.typography ?? "", texture: normalizeVibes(input.vibes),
    },
    composition: { aspectRatio: imageAspectRatio(input.aspectRatio) },
    route: {
      treatment: "uniform solid line",
      startMarker: !markers.enabled ? "none" : markers.mode === "loop" ? "one combined start/finish symbol; choose its appearance to suit the style" : "start symbol; choose its appearance to suit the style",
      finishMarker: !markers.enabled ? "none" : markers.mode === "loop" ? "one combined start/finish symbol; choose its appearance to suit the style" : "distinct finish symbol; choose its appearance to suit the style",
      startName: markers.enabled ? markers.startName?.trim() ?? "" : "",
      finishName: markers.enabled ? markers.finishName?.trim() ?? "" : "",
    },
    geography: (input.geography ?? []).map(layer => ({ kind: layer.label || layer.id })),
    landmarks: [],
    text: {
      title: input.title, subtitle: input.subtitle,
      stats: people ? [...input.stats.filter(stat => stat.label.trim().toLowerCase() !== "with"), { label: "With", value: people }] : input.stats,
    },
    grounding: { images: input.grounding.map(({ index, role, legend }) => ({ index, role, legend })) },
  });
  spec.finalPrompt = initialImagePrompt(spec);
  return { spec, cost: 0 };
}

/** Compatibility endpoint; uploaded references remain account-scoped, with no model call. */
export async function planPoster(userId: string, input: PlannerInput) {
  if (input.referenceBatchId) {
    const refs = await resolveReferences(userId, input.referenceBatchId);
    if (refs.length !== input.grounding?.length) throw new Error("reference metadata must match the uploaded images");
  } else if (input.grounding?.some(ref => ref.url)) {
    throw new Error("a reference batch id is required for hosted images");
  }
  return buildInitialPoster(input);
}
