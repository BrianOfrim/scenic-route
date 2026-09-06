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
