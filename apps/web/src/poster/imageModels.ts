const IMAGE_MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isImageModelId(value: string) {
  return IMAGE_MODEL_ID.test(value.trim());
}

/** Server-configured image model from OPENROUTER_IMAGE_MODEL (via capabilities). */
export function resolveConfiguredImageModel(serverDefault?: string | null) {
  const trimmed = serverDefault?.trim() ?? "";
  return trimmed && isImageModelId(trimmed) ? trimmed : null;
}

type ModelOptionLike = {
  id: string;
  name: string;
  maxReferences: number;
  maxImages?: number;
  qualities?: string[];
};

/** Single configured model from capabilities; synthesize when OpenRouter omits it. */
export function uiImageModelFromCapabilities(
  models: ModelOptionLike[],
  serverDefault?: string | null,
): ModelOptionLike | null {
  const configured = resolveConfiguredImageModel(serverDefault);
  if (!configured) return null;
  const found = models.find((model) => model.id === configured);
  if (found) return { ...found, qualities: found.qualities ?? [] };
  return {
    id: configured,
    name: configured,
    maxReferences: 3,
    maxImages: 1,
    qualities: [],
  };
}

/** Muse Image is the sole model used for new poster generations. */
export const ACTIVE_IMAGE_MODEL_IDS = ["meta/muse-image"] as const;

/** Capability data supplies current limits and labels, with a safe fallback. */
export function activeImageModelsFromCapabilities(models: ModelOptionLike[]): ModelOptionLike[] {
  return ACTIVE_IMAGE_MODEL_IDS.map((id) => {
    const found = models.find((model) => model.id === id);
    if (found) return { ...found, qualities: found.qualities ?? [] };
    return { id, name: id, maxReferences: 3, maxImages: 1, qualities: [] };
  });
}

export function uniqueIds(ids: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function formatDurationMs(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function finiteMoney(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

export function sumCosts(values: Array<number | null | undefined>) {
  const amounts = values.map(finiteMoney).filter((value): value is number => value != null);
  return amounts.length ? roundMoney(amounts.reduce((sum, value) => sum + value, 0)) : null;
}

function roundMoney(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export function formatUsd(value: number) {
  return `$${value.toFixed(3)}`;
}

/** Planner cost plus image-gen cost. `cost` is treated as image-gen when `imageCost` is omitted. */
export function formatCostBreakdown(input: {
  promptCost?: number | null;
  imageCost?: number | null;
  cost?: number | null;
}) {
  const prompt = finiteMoney(input.promptCost);
  const image = finiteMoney(input.imageCost) ?? finiteMoney(input.cost);
  if (prompt == null && image == null) return "";
  if (prompt == null) return formatUsd(image as number);
  if (image == null) return `prompt ${formatUsd(prompt)}`;
  return `prompt ${formatUsd(prompt)} · image ${formatUsd(image)}`;
}

export type CostItem = {
  styleId?: string;
  promptCost?: number | null;
  imageCost?: number | null;
  cost?: number | null;
};

/** Prompt cost is counted once per style; image cost is summed across every item. */
export function batchCosts(items: CostItem[]) {
  const prompts = new Map<string, number>();
  const images: number[] = [];
  items.forEach((item, index) => {
    const prompt = finiteMoney(item.promptCost);
    if (prompt != null) {
      const key = item.styleId?.trim() || `\0${index}`;
      if (!prompts.has(key)) prompts.set(key, prompt);
    }
    const image = finiteMoney(item.imageCost) ?? finiteMoney(item.cost);
    if (image != null) images.push(image);
  });
  const promptCost = prompts.size ? [...prompts.values()].reduce((sum, value) => sum + value, 0) : null;
  const imageCost = images.length ? images.reduce((sum, value) => sum + value, 0) : null;
  return { promptCost, imageCost, total: sumCosts([promptCost, imageCost]) };
}

export function formatBatchCost(items: CostItem[]) {
  const { promptCost, imageCost, total } = batchCosts(items);
  if (total == null) return "";
  if (promptCost != null && imageCost != null) {
    return `total ${formatUsd(total)} · prompt ${formatUsd(promptCost)} · image ${formatUsd(imageCost)}`;
  }
  return `total ${formatUsd(total)}`;
}

export function shortModelLabel(id: string, name?: string | null) {
  const trimmed = name?.trim();
  if (trimmed && trimmed !== id) return trimmed;
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id || "Unknown model";
}

export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "auto";

export function normalizeImageQuality(value?: string | null): ImageQuality | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  return (IMAGE_QUALITIES as readonly string[]).includes(trimmed) ? (trimmed as ImageQuality) : null;
}

export function normalizeImageQualities(values?: string[] | null): ImageQuality[] {
  const next = uniqueIds(
    (values ?? []).map((item) => normalizeImageQuality(item)).filter((item): item is ImageQuality => item != null),
  ) as ImageQuality[];
  return next.length ? next : [DEFAULT_IMAGE_QUALITY];
}

export function shortQualityLabel(quality?: string | null) {
  const normalized = normalizeImageQuality(quality);
  if (!normalized) return null;
  return normalized;
}

export function modelSupportsQuality(model?: { qualities?: string[] } | null) {
  return Boolean(model?.qualities?.length);
}

/** Qualities to request for a model; falls back to a single omitted pass when unsupported. */
export function qualitiesForModel(model: { qualities?: string[] } | undefined, selected: string[]) {
  if (model && !modelSupportsQuality(model)) return [null] as Array<ImageQuality | null>;
  const allowed = model?.qualities?.length
    ? new Set(model.qualities.map((item) => item.trim().toLowerCase()))
    : null;
  const picked = normalizeImageQualities(selected).filter((item) => !allowed || allowed.has(item));
  return (picked.length ? picked : [DEFAULT_IMAGE_QUALITY]) as Array<ImageQuality | null>;
}

export function minMaxReferences(ids: string[], models: Array<{ id: string; maxReferences?: number }>) {
  const values = ids.map((id) => models.find((item) => item.id === id)?.maxReferences || 3);
  return values.length ? Math.min(...values) : 3;
}

const VARIANTS_KEY = "scenic-route.variants";
export const DEFAULT_VARIANTS = 4;
export const MAX_VARIANTS = 10;

export function clampVariants(value?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VARIANTS;
  return Math.min(MAX_VARIANTS, Math.max(1, Math.round(n)));
}

export function readStoredVariants() {
  try {
    const raw = localStorage.getItem(VARIANTS_KEY);
    if (raw == null) return DEFAULT_VARIANTS;
    return clampVariants(Number(raw));
  } catch {
    return DEFAULT_VARIANTS;
  }
}

export function writeStoredVariants(value: number) {
  try {
    localStorage.setItem(VARIANTS_KEY, String(clampVariants(value)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function variantCount(requested: number, maxImages?: number) {
  const allowed = Number.isFinite(maxImages) && maxImages ? Math.max(1, Math.round(maxImages)) : 1;
  return Math.min(clampVariants(requested), allowed);
}

export function posterVariantLabel(
  item: { posterId: string; model?: string; styleId?: string; quality?: string; variant?: number },
  group: Array<{ posterId: string; model?: string; styleId?: string; quality?: string; variant?: number }>,
) {
  const peers = group.filter(
    (row) =>
      row.model === item.model &&
      row.styleId === item.styleId &&
      (row.quality ?? "") === (item.quality ?? ""),
  );
  if (peers.length <= 1) return null;
  if (item.variant != null) return String(item.variant);
  const index = peers.findIndex((row) => row.posterId === item.posterId);
  return index >= 0 ? String(index + 1) : null;
}
