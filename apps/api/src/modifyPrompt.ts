import { SINGLE_ROUTE_RULE, TERRAIN_REFERENCE_RULE, TITLE_BLOCK_LAYOUT_RULE } from "./posterSpec";

/** Image 1 is artwork; all later images are grounding, never additional posters. */
export const MODIFY_SOURCE_RULE =
  "Image 1 is the current poster. Keep everything that still belongs and apply only the requested changes. Later images are geographic grounding for the route and land — do not copy their schematic colors, numbered discs, or letters onto the finished poster. " + SINGLE_ROUTE_RULE;

export type PosterDesignHistory = { basePrompt: string; editRequests: string[] };
type HistorySource = Partial<PosterDesignHistory> & {
  posterId: string;
  prompt?: string;
  previousPosterId?: string;
  refineNotes?: string;
};

/** Recover old refinement chains once; new records carry their complete history. */
export async function posterDesignHistory(
  source: HistorySource,
  load: (posterId: string) => Promise<HistorySource | null>,
): Promise<PosterDesignHistory> {
  const edits: string[] = [];
  const seen = new Set<string>();
  let current = source;
  while (!seen.has(current.posterId)) {
    seen.add(current.posterId);
    if (current.basePrompt?.trim()) {
      return { basePrompt: current.basePrompt.trim(), editRequests: [...(current.editRequests ?? []), ...edits] };
    }
    if (!current.previousPosterId) break;
    const parent = await load(current.previousPosterId);
    if (!parent || seen.has(parent.posterId)) break;
    if (current.refineNotes?.trim()) edits.unshift(current.refineNotes.trim());
    current = parent;
  }
  // An orphaned legacy record's saved prompt is the best available design brief.
  return { basePrompt: current.prompt?.trim() ?? "", editRequests: edits };
}

export function buildModifyPrompt(input: {
  request: string;
  grounding: Array<{ role: string }>;
  annotated?: boolean;
}): string {
  const request = input.request.trim();
  if (!request) throw new Error("a modification request is required");
  return [
    input.annotated ? MODIFY_SOURCE_RULE.replace("Later images are", "Images 3 onward are") : MODIFY_SOURCE_RULE,
    input.annotated ? "Image 2 is an annotated copy of Image 1. The magenta outlines with white borders mark the area referred to by the requested change below. Apply that change to the indicated content in Image 1. These marks are guidance, not artwork or a strict pixel mask. Do not reproduce any outlines or annotation marks in the result. Preserve unrelated content." : "",
    input.grounding.map((image, index) => `Image ${index + (input.annotated ? 3 : 2)}: ${image.role}.`).join("\n"),
    "Preserve the exact GPS route geometry, every segment, bend, crossing, out-and-back and gap, and its position relative to the geography. Do not add, omit, straighten or move route segments or geographic features. Keep the route continuous, unobscured and clearly contrasted against its background. Preserve north-up orientation. Do not invent place names.",
    "Keep the existing title, other text, landmarks, palette and style unless the requested change explicitly changes them. Do not print the edit instructions or reference-image headings.",
    "For terrain affected by the requested change: " + TERRAIN_REFERENCE_RULE,
    TITLE_BLOCK_LAYOUT_RULE,
    "If the current poster has a title, keep it large and readable when the whole poster is viewed on a phone, with font size at least 8% of poster width, unless the request changes its size or removes it. If it has no title, do not add one unless requested.",
    `Requested change (apply to Image 1):\n${request}`,
  ].filter(Boolean).join("\n\n");
}

/** Variants use only grounding images, so their brief has no current-poster reference. */
export function buildVariantPrompt(history: PosterDesignHistory): string {
  if (!history.editRequests.length) return history.basePrompt;
  return [
    history.basePrompt,
    "Apply these design changes in order to the original brief above. Later changes supersede earlier changes and the original brief where they conflict, except that exact route geometry and geographic fidelity remain mandatory. These are visual instructions, not text to print:",
    ...history.editRequests.map((request, index) => `${index + 1}. ${JSON.stringify(request)}`),
  ].join("\n\n");
}
