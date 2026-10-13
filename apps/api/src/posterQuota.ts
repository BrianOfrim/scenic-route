import { imageAttemptContext } from "./jobContext";
import { randomUUID } from "node:crypto";
import { query, queryOne, withTransaction, type SqlClient } from "./db";
import { imageGenerationTimeoutMs } from "./openrouter";

export class PosterQuotaError extends Error {
  readonly status = 429;
}

export function posterQuotaMonth(now = new Date()) {
  const month = now.toISOString().slice(0, 7) + "-01";
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return { month, resetsAt };
}

async function usage(userId: string, month: string, client?: SqlClient) {
  const row = await queryOne<{ used: number; reserved: number }>(`
    SELECT COALESCE(SUM(generated), 0)::int AS used,
      COALESCE(SUM(reserved) FILTER (WHERE generated IS NULL AND expires_at > now()), 0)::int AS reserved
    FROM poster_generation_usage WHERE user_id = $1 AND month = $2::date
  `, [userId, month], client);
  return row!;
}

export async function getPosterQuota(userId: string) {
  const { month, resetsAt } = posterQuotaMonth();
  const user = await queryOne<{ poster_monthly_limit: number | null }>(
    'SELECT poster_monthly_limit FROM "user" WHERE id = $1', [userId],
  );
  if (!user) throw new Error("user not found");
  const { used, reserved } = await usage(userId, month);
  const limit = user.poster_monthly_limit;
  return { limit, used, reserved, remaining: limit === null ? null : Math.max(0, limit - used - reserved), resetsAt };
}

/** Reserve before calling the image provider; the user row serializes concurrent admissions. */
export async function reservePosterQuota(userId: string, count: number) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("poster count must be a positive integer");
  const id = randomUUID();
  const attempt = imageAttemptContext.getStore();
  // Cover both the provider queue wait and generation deadline, with time for settlement.
  const lifetimeMs = Math.max(24 * 60 * 60 * 1000, 2 * imageGenerationTimeoutMs(count) + 60 * 60 * 1000);
  await withTransaction(async client => {
    const user = await queryOne<{ poster_monthly_limit: number | null }>(
      'SELECT poster_monthly_limit FROM "user" WHERE id = $1 FOR UPDATE', [userId], client,
    );
    if (!user) throw new Error("user not found");
    if (attempt) {
      const owned = await client.query(`SELECT j.id FROM image_jobs j JOIN image_attempts a ON a.id=j.attempt_id
        JOIN "user" u ON u.id=j.user_id WHERE a.id=$1 AND a.execution_token=$2 AND a.lease_until>now()
        AND a.terminal_at IS NULL AND j.state='generating' AND NOT u.image_deleting FOR UPDATE OF j,a`, [attempt.id,attempt.token]);
      if (!owned.rowCount) throw new Error("Image attempt ownership was lost before quota reservation");
    }
    const { month, resetsAt } = posterQuotaMonth();
    const { used, reserved } = await usage(userId, month, client);
    const limit = user.poster_monthly_limit;
    const remaining = limit === null ? null : Math.max(0, limit - used - reserved);
    if (remaining !== null && count > remaining) {
      throw new PosterQuotaError(`Monthly poster limit reached: ${remaining} of ${limit} posters available. This request needs ${count}. Your limit resets on ${resetsAt.slice(0, 10)} (UTC).`);
    }
    // Interrupted processes must not hold capacity forever.
    await query(`INSERT INTO poster_generation_usage (id, user_id, month, reserved, expires_at)
      VALUES ($1, $2, $3::date, $4, now() + $5 * interval '1 millisecond')`, [id, userId, month, count, lifetimeMs], client);
    if (attempt) await client.query("UPDATE image_attempts SET quota_id=$2 WHERE id=$1", [attempt.id,id]);
  });
  return {
    id,
    async settle(generated: number) {
      if (!Number.isSafeInteger(generated) || generated < 0 || generated > count) throw new Error("invalid generated poster count");
      await query("UPDATE poster_generation_usage SET generated = $2 WHERE id = $1 AND generated IS NULL", [id, generated]);
    },
  };
}

/** Hold capacity while generating; charge only after saving succeeds (or durable publication). */
export function withPosterQuota<T extends { images: unknown[] }>(userId: string, count: number, generate: () => Promise<T>): Promise<T>;
export function withPosterQuota<T extends { images: unknown[] }, R>(userId: string, count: number, generate: () => Promise<T>, save: (result: T) => Promise<R>): Promise<R>;
export async function withPosterQuota<T extends { images: unknown[] }, R>(userId: string, count: number, generate: () => Promise<T>, save?: (result: T) => Promise<R>): Promise<T | R> {
  const reservation = await reservePosterQuota(userId, count);
  const attempt = imageAttemptContext.getStore();
  let generated = 0;
  try {
    if (attempt) await attempt.quota(reservation.id);
    const result = await generate();
    // Do not publish unexpected extra outputs beyond the capacity admitted for this request.
    result.images = result.images.slice(0, count);
    if (attempt) await attempt.received(result.images.length);
    const saved = save ? await save(result) : result;
    generated = result.images.length;
    return saved;
  } finally {
    // Durable attempts settle atomically with publication or failure, including worker recovery.
    if (!attempt) await reservation.settle(generated);
  }
}
