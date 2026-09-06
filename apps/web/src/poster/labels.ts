/**
 * Recommended number of landmark names on the schematic and in the image
 * prompt. Past roughly a dozen, image models start dropping, merging, or
 * misspelling names. The UI warns when this is exceeded but does not cap.
 */
export const MAX_LABELS = 12;

/**
 * Merge selected landmarks. Landmarks the user added by hand come first
 * (they asked for them explicitly), then the API's ranked suggestions in
 * their existing order. Names are deduped case-insensitively, with the
 * custom entry winning.
 */
export function prioritizeLabels<T extends { name: string }>(
  suggested: T[],
  custom: T[],
): T[] {
  const seen = new Set<string>();
  const all: T[] = [];
  for (const poi of [...custom, ...suggested]) {
    const key = poi.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    all.push(poi);
  }
  return all;
}
