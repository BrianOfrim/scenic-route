import { getDb, setJsonSetting } from "./db";
import { bboxFromLatLng } from "./geo";
import {
  activityHasGps,
  getSyncState,
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

function activityCounts() {
  const row = getDb()
    .prepare(
      `SELECT
        COUNT(*) as listed,
        SUM(CASE WHEN streams_synced = 1 THEN 1 ELSE 0 END) as synced,
        SUM(CASE WHEN streams_synced = 0 AND has_gps = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN has_gps = 0 OR streams_synced = 2 THEN 1 ELSE 0 END) as skipped
      FROM activities`,
    )
    .get() as {
    listed: number;
    synced: number;
    pending: number;
    skipped: number;
  };
  return {
    listed: row.listed ?? 0,
    streamsSynced: row.synced ?? 0,
    streamsPending: row.pending ?? 0,
    skipped: row.skipped ?? 0,
  };
}

function upsertActivity(activity: StravaActivitySummary) {
  const hasGps = activityHasGps(activity) ? 1 : 0;
  const start = activity.start_latlng;
  const startBbox =
    Array.isArray(start) && start.length >= 2
      ? JSON.stringify([start[1], start[0], start[1], start[0]])
      : null;
  getDb()
    .prepare(
      `INSERT INTO activities (
         id, name, type, sport_type, start_date, distance, moving_time, elapsed_time,
         total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced, bbox
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         sport_type = excluded.sport_type,
         start_date = excluded.start_date,
         distance = excluded.distance,
         moving_time = excluded.moving_time,
         elapsed_time = excluded.elapsed_time,
         total_elevation_gain = excluded.total_elevation_gain,
         average_speed = excluded.average_speed,
         max_speed = excluded.max_speed,
         trainer = excluded.trainer,
         has_gps = excluded.has_gps,
         bbox = COALESCE(activities.bbox, excluded.bbox)`,
    )
    .run(
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
    );
}

async function syncActivityList(state: SyncState): Promise<SyncState> {
  let page = state.listComplete ? 1 : state.listPage;
  let listComplete = state.listComplete;
  const existing = new Set(
    (getDb().prepare("SELECT id FROM activities").all() as { id: number }[]).map((row) => row.id),
  );
  const maxPages = listComplete ? 3 : 8;

  for (let i = 0; i < maxPages; i += 1) {
    const { data } = await stravaFetch<StravaActivitySummary[]>(
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
        upsertActivity(activity);
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
  setJsonSetting("sync_state", next);
  return next;
}

async function syncStreams() {
  const pending = getDb()
    .prepare("SELECT id FROM activities WHERE streams_synced = 0 AND has_gps = 1 LIMIT ?")
    .all(STREAMS_PER_CALL) as { id: number }[];

  for (const activity of pending) {
    try {
      const { data } = await stravaFetch<StreamPayload>(
        `/activities/${activity.id}/streams?keys=latlng,time,velocity_smooth,altitude&key_by_type=true`,
      );
      const points = data.latlng?.data ?? [];
      if (points.length < 2) {
        getDb()
          .prepare("UPDATE activities SET streams_synced = 2, has_gps = 0 WHERE id = ?")
          .run(activity.id);
        continue;
      }
      getDb()
        .prepare(
          `UPDATE activities
           SET streams_synced = 1, latlng = ?, time = ?, velocity = ?, altitude = ?, bbox = ?, has_gps = 1
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(points),
          data.time?.data ? JSON.stringify(data.time.data) : null,
          data.velocity_smooth?.data ? JSON.stringify(data.velocity_smooth.data) : null,
          data.altitude?.data ? JSON.stringify(data.altitude.data) : null,
          JSON.stringify(bboxFromLatLng(points)),
          activity.id,
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("404")) {
        getDb()
          .prepare("UPDATE activities SET streams_synced = 2, has_gps = 0 WHERE id = ?")
          .run(activity.id);
        continue;
      }
      throw error;
    }
  }
}

export async function runSync(): Promise<SyncProgress> {
  const state = await syncActivityList(getSyncState());
  await syncStreams();
  const counts = activityCounts();
  return {
    connected: true,
    listComplete: state.listComplete,
    ...counts,
    done: state.listComplete && counts.streamsPending === 0,
  };
}

export function getSyncProgress() {
  const state = getSyncState();
  return {
    listComplete: state.listComplete,
    ...activityCounts(),
  };
}
