export const PEOPLE_MAX = 12;
export const PEOPLE_NAME_MAX = 40;
export const PEOPLE_INPUT_MAX = 300;

/** Suggest one editable name without printing the account's email address. */
export function defaultPeopleForUser(user: { name?: string | null; email: string }): string {
  const accountName = user.name?.trim();
  const name = accountName && !accountName.includes("@")
    ? accountName
    : user.email.split("@")[0].split("+")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  return name.replace(/\s+/g, " ").trim().slice(0, PEOPLE_NAME_MAX).trim();
}

/** Split a free-text list into the names that will be printed on the poster. */
export function parsePeople(raw: string, enabled = true): string[] {
  if (!enabled) return [];
  const chunks = raw
    .replace(/[\n;]+/g, ",")
    .replace(/\s+&\s+/g, ", ")
    .replace(/\s+and\s+/gi, ", ")
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim().slice(0, PEOPLE_NAME_MAX).trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of chunks) {
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
