import { OpenRouterError, chatJson } from "./openrouter";

export const MODIFY_PROMPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: { type: "string" },
  },
};

/** Locked prefix so the image model treats image 1 as the artwork to revise. */
export const MODIFY_SOURCE_RULE =
  "Image 1 is the current poster. Keep everything that still belongs and apply only the requested changes. Later images are geographic grounding for the route and land — do not copy their schematic colors, numbered discs, or letters onto the finished poster.";

export type ModifyPromptInput = {
  imageUrl: string;
  previousPrompt: string;
  request: string;
  userId?: string;
};

export function buildModifyMessages(input: ModifyPromptInput) {
  return [
    {
      role: "system",
      content: [
        "You revise image-generation prompts for a map-poster model.",
        'Reply with a single JSON object: {"prompt": "..."}.',
        "You are shown the current poster and the prompt that produced it.",
        "Apply the user's requested change. Keep the route shape, geography, landmarks, title, and style unless the user asks to change them.",
        "If the poster has a title, keep it a large display title, clearly readable when the whole poster is viewed on a phone, not a zoomed crop, with the title font at least 16% of the poster width, unless the user asks to change the title size or remove the title. Do not add a title when the design has none.",
        "Write a complete replacement prompt, not a list of deltas.",
        "The image model will receive the current poster as image 1, then the same geographic grounding images as before (schematic, then satellite if present). Rewrite any reference-image numbering to match that order.",
        "Tell the image model to start from image 1 (the current poster) and apply only the requested changes.",
        "Keep critical route-fidelity instructions. Do not invent place names.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Current poster image is attached.",
            "",
            "Previous prompt:",
            input.previousPrompt.trim(),
            "",
            "Requested change:",
            input.request.trim(),
          ].join("\n"),
        },
        {
          type: "image_url",
          image_url: { url: input.imageUrl },
        },
      ],
    },
  ];
}

export function withModifySourceRule(prompt: string) {
  const text = prompt.trim();
  if (!text) return "";
  if (text.startsWith(MODIFY_SOURCE_RULE)) return text;
  return `${MODIFY_SOURCE_RULE}\n\n${text}`;
}

export async function revisePosterPrompt(
  input: ModifyPromptInput,
): Promise<{ prompt: string; cost: number | null; model: string }> {
  const request = input.request.trim();
  const previousPrompt = input.previousPrompt.trim();
  if (!request) throw new OpenRouterError("a modification request is required", 400);
  if (!previousPrompt) throw new OpenRouterError("previous prompt is required", 400);
  const { value, cost, model } = await chatJson<{ prompt?: unknown }>({
    messages: buildModifyMessages({ ...input, request, previousPrompt }),
    schemaName: "poster_prompt_revision",
    schema: MODIFY_PROMPT_SCHEMA,
    label: "revise-prompt",
    user: input.userId,
  });
  const prompt = typeof value?.prompt === "string" ? value.prompt.trim() : "";
  if (!prompt) throw new OpenRouterError("modifier did not return a revised prompt", 502);
  return { prompt: withModifySourceRule(prompt), cost, model };
}
