import type { AuthUser } from "./auth";
import { PENDING_USER_ID, deleteSetting, getJsonSetting, getSetting, query, queryOne, setSetting } from "./db";
import { posterStore } from "./storage";
import type { StravaTokens, SyncState } from "./strava";

const CLAIM_KEY = "bootstrap_claimed";

export function bootstrapEmail() {
  return process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase() || "";
}

export function canClaimBootstrap(email: string) {
  const target = bootstrapEmail();
  return !target || email.trim().toLowerCase() === target;
}

async function hasPendingActivities() {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM activities WHERE user_id = $1",
    [PENDING_USER_ID],
  );
  return (row?.n ?? 0) > 0;
}

async function hasLegacyData() {
  const tokens = await getSetting("strava_tokens");
  const sync = await getSetting("sync_state");
  return Boolean(tokens || sync || (await hasPendingActivities()) || (await posterStore().hasUnscopedPosters()));
}

export async function maybeBootstrapUser(user: AuthUser) {
  const claimed = await getSetting(CLAIM_KEY);
  const leftover = await hasLegacyData();
  if (claimed) {
    if (leftover) throw new Error("unscoped data remains after bootstrap");
    return;
  }
  if (!leftover) return;
  if (!canClaimBootstrap(user.email)) return;
  await claimBootstrap(user.id);
}

export async function claimBootstrap(userId: string) {
  const tokens = await getJsonSetting<StravaTokens>("strava_tokens");
  const syncState = (await getJsonSetting<SyncState>("sync_state")) ?? { listComplete: false, listPage: 1 };
  if (tokens) {
    const athleteId = tokens.athlete?.id ?? null;
    await query(
      `INSERT INTO strava_connections (
         user_id, access_token, refresh_token, expires_at, athlete_id, athlete, sync_state
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         athlete_id = EXCLUDED.athlete_id,
         athlete = EXCLUDED.athlete,
         sync_state = EXCLUDED.sync_state`,
      [
        userId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at,
        athleteId,
        tokens.athlete ? JSON.stringify(tokens.athlete) : null,
        JSON.stringify(syncState),
      ],
    );
  }
  await query("UPDATE activities SET user_id = $1 WHERE user_id = $2", [userId, PENDING_USER_ID]);
  await posterStore().migrateUnscopedToUser(userId);
  await deleteSetting("strava_tokens");
  await deleteSetting("sync_state");
  await setSetting(CLAIM_KEY, userId);
}
