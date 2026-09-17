import { query, queryOne } from "./db";
import { bboxFromLatLng } from "./geo";
import {
  activityHasGps,
  getSyncState,
  setSyncState,
  stravaFetch,
  type StravaActivitySummary,
  type SyncState,
} from "./strava";

const PAGE_SIZE = 200;
const STREAMS_PER_CALL = 15;

type StreamPayload = {
  latlng?: { data?: [number, number][] };
  time?: { data?: number[] };
  velocity_smooth?: { data?: number[] };
  altitude?: { data?: number[] };
};

export type SyncProgress = {
  connected: true;
  listComplete: boolean;
  listed: number;
  streamsSynced: number;
  streamsPending: number;
  skipped: number;
  done: boolean;
  rateLimited?: boolean;
  retryAfter?: number;
};

async function activityCounts(userId: string) {
  const row = (await queryOne<{
    listed: number;
    synced: number;
    pending: number;
    skipped: number;
  }>(
    `SELECT
        COUNT(*)::int AS listed,
        COALESCE(SUM(CASE WHEN streams_synced = 1 THEN 1 ELSE 0 END), 0)::int AS synced,
        COALESCE(SUM(CASE WHEN streams_synced = 0 AND has_gps = 1 THEN 1 ELSE 0 END), 0)::int AS pending,
        COALESCE(SUM(CASE WHEN has_gps = 0 OR streams_synced = 2 THEN 1 ELSE 0 END), 0)::int AS skipped
      FROM activities
      WHERE user_id = $1`,
    [userId],
  )) ?? { listed: 0, synced: 0, pending: 0, skipped: 0 };
  return {
    listed: row.listed ?? 0,
    streamsSynced: row.synced ?? 0,
    streamsPending: row.pending ?? 0,
    skipped: row.skipped ?? 0,
  };
}

async function upsertActivity(userId: string, activity: StravaActivitySummary) {
  const hasGps = activityHasGps(activity) ? 1 : 0;
  const start = activity.start_latlng;
  const startBbox =
    Array.isArray(start) && start.length >= 2
      ? JSON.stringify([start[1], start[0], start[1], start[0]])
      : null;
  await query(
    `INSERT INTO activities (
       user_id, id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
       total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced, bbox
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (user_id, id) DO UPDATE SET
       name = EXCLUDED.name,
       "type" = EXCLUDED."type",
       sport_type = EXCLUDED.sport_type,
       start_date = EXCLUDED.start_date,
       distance = EXCLUDED.distance,
       moving_time = EXCLUDED.moving_time,
       elapsed_time = EXCLUDED.elapsed_time,
       total_elevation_gain = EXCLUDED.total_elevation_gain,
       average_speed = EXCLUDED.average_speed,
       max_speed = EXCLUDED.max_speed,
       trainer = EXCLUDED.trainer,
       has_gps = EXCLUDED.has_gps,
       bbox = COALESCE(activities.bbox, EXCLUDED.bbox)`,
    [
      userId,
      activity.id,
      activity.name ?? "Untitled",
      activity.type ?? "Unknown",
      activity.sport_type ?? activity.type ?? "Unknown",
      activity.start_date,
      activity.distance ?? 0,
      activity.moving_time ?? null,
      activity.elapsed_time ?? null,
      activity.total_elevation_gain ?? null,
      activity.average_speed ?? null,
      activity.max_speed ?? null,
      activity.trainer ? 1 : 0,
      hasGps,
      hasGps ? 0 : 2,
      startBbox,
    ],
  );
}

async function syncActivityList(userId: string, state: SyncState): Promise<SyncState> {
  let page = state.listComplete ? 1 : Math.max(1, state.listPage || 1);
  let listComplete = state.listComplete;
  const existing = new Set(
    (await query<{ id: number }>("SELECT id FROM activities WHERE user_id = $1", [userId])).map((row) => row.id),
  );
  const maxPages = listComplete ? 3 : 8;

  for (let i = 0; i < maxPages; i += 1) {
    const { data } = await stravaFetch<StravaActivitySummary[]>(
      userId,
      `/athlete/activities?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (data.length === 0) {
      listComplete = true;
      break;
    }
    let allKnown = true;
    for (const activity of data) {
      if (!existing.has(activity.id)) {
        allKnown = false;
        await upsertActivity(userId, activity);
        existing.add(activity.id);
      }
    }
    if (data.length < PAGE_SIZE) {
      listComplete = true;
      break;
    }
    if (listComplete && allKnown) break;
    page += 1;
  }

  const next: SyncState = { listComplete, listPage: listComplete ? 1 : page };
  await setSyncState(userId, next);
  return next;
}

async function syncStreams(userId: string) {
  const pending = await query<{ id: number }>(
    "SELECT id FROM activities WHERE user_id = $1 AND streams_synced = 0 AND has_gps = 1 LIMIT $2",
    [userId, STREAMS_PER_CALL],
  );

  for (const activity of pending) {
    try {
      const { data } = await stravaFetch<StreamPayload>(
        userId,
        `/activities/${activity.id}/streams?keys=latlng,time,velocity_smooth,altitude&key_by_type=true`,
      );
      const points = data.latlng?.data ?? [];
      if (points.length < 2) {
        await query("UPDATE activities SET streams_synced = 2, has_gps = 0 WHERE user_id = $1 AND id = $2", [
          userId,
          activity.id,
        ]);
        continue;
      }
      await query(
        `UPDATE activities
         SET streams_synced = 1, latlng = $1, "time" = $2, velocity = $3, altitude = $4, bbox = $5, has_gps = 1
         WHERE user_id = $6 AND id = $7`,
        [
          JSON.stringify(points),
          data.time?.data ? JSON.stringify(data.time.data) : null,
          data.velocity_smooth?.data ? JSON.stringify(data.velocity_smooth.data) : null,
          data.altitude?.data ? JSON.stringify(data.altitude.data) : null,
          JSON.stringify(bboxFromLatLng(points)),
          userId,
          activity.id,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("404")) {
        await query("UPDATE activities SET streams_synced = 2, has_gps = 0 WHERE user_id = $1 AND id = $2", [
          userId,
          activity.id,
        ]);
        continue;
      }
      throw error;
    }
  }
}

export async function runSync(userId: string): Promise<SyncProgress> {
  const state = await syncActivityList(userId, await getSyncState(userId));
  await syncStreams(userId);
  const counts = await activityCounts(userId);
  return {
    connected: true,
    listComplete: state.listComplete,
    ...counts,
    done: state.listComplete && counts.streamsPending === 0,
  };
}

export async function getSyncProgress(userId: string) {
  const state = await getSyncState(userId);
  return {
    listComplete: state.listComplete,
    ...(await activityCounts(userId)),
  };
}
