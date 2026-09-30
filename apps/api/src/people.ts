export const PEOPLE_MAX = 12;
export const PEOPLE_NAME_MAX = 40;

/** Names already split by the editor. Trim, clip, and drop duplicates. */
export function normalizePeople(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.replace(/\s+/g, " ").trim().slice(0, PEOPLE_NAME_MAX).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= PEOPLE_MAX) break;
  }
  return names;
}

/** "Alex" / "Alex and Jordan" / "Alex, Jordan, and Sam". */
export function formatPeople(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function peopleStatValue(value: unknown): string {
  return formatPeople(normalizePeople(value));
}
