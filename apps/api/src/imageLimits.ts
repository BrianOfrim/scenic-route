import { queryOne } from "./db";
import { providerQueue } from "./requestQueue";

export type ImageLimits = { active: number | null; unfinished: number | null; selections: number | null };
export function parseImageLimits(raw: Record<string, unknown> = {}): ImageLimits {
  const defaults: ImageLimits = { active: Number(process.env.OPENROUTER_IMAGE_USER_CONCURRENCY || 8), unfinished: 16, selections: 8 };
  for (const key of Object.keys(defaults) as (keyof ImageLimits)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)) throw new Error(`Invalid ${key} image limit`);
    defaults[key] = value as number | null;
  }
  return defaults;
}
export async function getImageLimits(userId: string): Promise<ImageLimits> {
  const row = await queryOne<{ image_limits: Record<string, unknown> }>('SELECT image_limits FROM "user" WHERE id = $1', [userId]);
  if (!row) throw new Error("Account not found");
  return parseImageLimits(row.image_limits);
}
export async function configureImageLimits(userId: string) {
  const limits = await getImageLimits(userId);
  providerQueue("image").setOwnerLimits(userId, limits.active ?? Infinity, limits.unfinished ?? Infinity);
  return limits;
}
