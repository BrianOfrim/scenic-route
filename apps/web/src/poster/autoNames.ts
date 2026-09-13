import { featureIdForKind } from "./featureCatalog";

export function takeFreshNames(selected: string[], incoming: string[], dismissed: Set<string>): string[] {
  const have = new Set(selected);
  const next = [...selected];
  for (const name of incoming) {
    if (have.has(name) || dismissed.has(name)) continue;
    have.add(name);
    next.push(name);
  }
  return next;
}

export function addedFeatureIds(previous: string[] | null, next: string[]): string[] {
  if (previous == null) return [];
  return next.filter((id) => !previous.includes(id));
}

export function forgetDismissedForLayers(
  dismissed: Set<string>,
  incoming: Array<{ name: string; kind?: string }>,
  addedLayerIds: string[],
): void {
  if (!addedLayerIds.length) return;
  const added = new Set(addedLayerIds);
  for (const item of incoming) {
    const id = featureIdForKind(item.kind);
    if (id && added.has(id)) dismissed.delete(item.name);
  }
}
