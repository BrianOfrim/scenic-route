const IMAGE_MODELS_KEY = "scenic-route.image-models";
const LEGACY_MODEL_KEY = "scenic-route.image-model";

export function readStoredImageModels(): string[] {
  try {
    const raw = localStorage.getItem(IMAGE_MODELS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return uniqueIds(parsed.filter((item): item is string => typeof item === "string"));
      }
    }
    const legacy = localStorage.getItem(LEGACY_MODEL_KEY)?.trim();
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

export function writeStoredImageModels(ids: string[]) {
  try {
    localStorage.setItem(IMAGE_MODELS_KEY, JSON.stringify(uniqueIds(ids)));
  } catch {
    /* ignore quota / private mode */
  }
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

export function shortModelLabel(id: string, name?: string | null) {
  const trimmed = name?.trim();
  if (trimmed && trimmed !== id) return trimmed;
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id || "Unknown model";
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
  item: { posterId: string; model?: string; styleId?: string; variant?: number },
  group: Array<{ posterId: string; model?: string; styleId?: string; variant?: number }>,
) {
  const peers = group.filter((row) => row.model === item.model && row.styleId === item.styleId);
  if (peers.length <= 1) return null;
  if (item.variant != null) return String(item.variant);
  const index = peers.findIndex((row) => row.posterId === item.posterId);
  return index >= 0 ? String(index + 1) : null;
}
