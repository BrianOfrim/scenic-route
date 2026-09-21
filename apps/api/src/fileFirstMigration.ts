import fs from "node:fs";
import path from "node:path";
import { PENDING_USER_ID, deleteSetting, getSetting, query, setSetting, withTransaction } from "./db";
import { LLM_TRACES_DIR } from "./paths";
import { posterStore } from "./storage";

const MIGRATION_KEY = "file_first_purge_v1";

type LegacyActivity = { user_id: string; id: number };

/**
 * One-time destructive migration authorized as part of removing the Strava API.
 * Uploaded/archive activities are retained; API-synced activities and every
 * identifiable derived poster are removed before credentials are dropped.
 */
export async function purgeLegacyApiData(): Promise<{
  activities: number;
  posters: number;
  traces: number;
}> {
  if (await getSetting(MIGRATION_KEY)) return { activities: 0, posters: 0, traces: 0 };

  const rows = await query<LegacyActivity>(
    `SELECT user_id, id FROM activities
     WHERE imported = 0 AND (source IS NULL OR source = 'strava')`,
  );
  const byUser = new Map<string, Set<number>>();
  for (const row of rows) {
    const ids = byUser.get(row.user_id) ?? new Set<number>();
    ids.add(Number(row.id));
    byUser.set(row.user_id, ids);
  }

  let posters = 0;
  for (const [userId, ids] of byUser) {
    posters += await posterStore().removeByActivityIds(userId || PENDING_USER_ID, ids);
  }

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM activities
       WHERE imported = 0 AND (source IS NULL OR source = 'strava')`,
    );
    await client.query("DROP TABLE IF EXISTS strava_connections");
    await deleteSetting("strava_tokens", client);
    await deleteSetting("sync_state", client);
    await setSetting(MIGRATION_KEY, new Date().toISOString(), client);
  });

  const traces = purgeTraceFiles();
  return { activities: rows.length, posters, traces };
}

function purgeTraceFiles(): number {
  if (!fs.existsSync(LLM_TRACES_DIR)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(LLM_TRACES_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.unlinkSync(path.join(LLM_TRACES_DIR, entry.name));
    removed += 1;
  }
  return removed;
}
