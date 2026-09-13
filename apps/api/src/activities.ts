import type { FeatureCollection, LineString } from "geojson";
import { query, queryOne, withTransaction, type SqlClient } from "./db";

export type ActivityRow = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number | null;
  elapsed_time: number | null;
  total_elevation_gain: number | null;
  average_speed: number | null;
  max_speed: number | null;
  trainer: number;
  has_gps: number;
  streams_synced: number;
  latlng: string | null;
  time: string | null;
  velocity: string | null;
  altitude: string | null;
  bbox: string | null;
  segment_efforts?: string | null;
  source?: string | null;
  imported?: number | null;
};

export type ActivitySource = "strava" | "gpx" | "fit" | "tcx";

export type ActivitySummary = {
  id: number;
  name: string;
  type: string;
  sportType: string;
  startDate: string;
  distance: number;
  movingTime: number | null;
  elapsedTime: number | null;
  elevationGain: number | null;
  averageSpeed: number | null;
  hasGps: boolean;
  streamsSynced: boolean;
  source: ActivitySource;
  imported: boolean;
};

export function activitySource(value: string | null | undefined): ActivitySource {
  return value === "gpx" || value === "fit" || value === "tcx" ? value : "strava";
}

export function toActivitySummary(
  row: Pick<
    ActivityRow,
    | "id"
    | "name"
    | "type"
    | "sport_type"
    | "start_date"
    | "distance"
    | "moving_time"
    | "elapsed_time"
    | "total_elevation_gain"
    | "average_speed"
    | "has_gps"
    | "streams_synced"
    | "source"
    | "imported"
  >,
): ActivitySummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    sportType: row.sport_type,
    startDate: row.start_date,
    distance: row.distance,
    movingTime: row.moving_time,
    elapsedTime: row.elapsed_time,
    elevationGain: row.total_elevation_gain,
    averageSpeed: row.average_speed,
    hasGps: row.has_gps === 1,
    streamsSynced: row.streams_synced === 1,
    source: activitySource(row.source),
    imported: isImported(row),
  };
}

export function isImported(row: Pick<ActivityRow, "source" | "imported" | "id">): boolean {
  return (
    row.imported === 1 ||
    row.source === "gpx" ||
    row.source === "fit" ||
    row.source === "tcx" ||
    row.id >= 2_000_000_000_000
  );
}

export async function listActivities(): Promise<ActivitySummary[]> {
  const rows = await query<
    Pick<
      ActivityRow,
      | "id"
      | "name"
      | "type"
      | "sport_type"
      | "start_date"
      | "distance"
      | "moving_time"
      | "elapsed_time"
      | "total_elevation_gain"
      | "average_speed"
      | "has_gps"
      | "streams_synced"
      | "source"
      | "imported"
    >
  >(
    `SELECT id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
            total_elevation_gain, average_speed, has_gps, streams_synced, source, imported
     FROM activities
     ORDER BY start_date DESC`,
  );

  return rows.map(toActivitySummary);
}

export async function getActivity(id: number, client?: SqlClient): Promise<ActivityRow | null> {
  return (await queryOne<ActivityRow>("SELECT * FROM activities WHERE id = $1", [id], client)) ?? null;
}

export async function deleteImportedByIds(
  ids: number[],
): Promise<{ deleted: ActivitySummary[]; skipped: number }> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  return withTransaction(async (client) => {
    const deleted: ActivitySummary[] = [];
    let skipped = 0;
    for (const id of unique) {
      const row = await getActivity(id, client);
      if (!row) continue;
      if (!isImported(row)) {
        skipped += 1;
        continue;
      }
      await query("DELETE FROM activities WHERE id = $1", [id], client);
      deleted.push(toActivitySummary(row));
    }
    return { deleted, skipped };
  });
}

export function parseLatLng(raw: string | null): [number, number][] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as [number, number][];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseNumberArray(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((value) => Number(value)) : [];
  } catch {
    return [];
  }
}

export function activityToFeatureCollection(row: ActivityRow): FeatureCollection<LineString> {
  const points = parseLatLng(row.latlng);
  if (points.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          activity_id: row.id,
          name: row.name,
          sport_type: row.sport_type,
          start_date: row.start_date,
          distance: row.distance,
        },
        geometry: {
          type: "LineString",
          coordinates: points.map(([lat, lng]) => [lng, lat]),
        },
      },
    ],
  };
}

export function getCachedSegmentEfforts(row: ActivityRow): unknown[] | null {
  if (row.segment_efforts == null) return null;
  try {
    const parsed = JSON.parse(row.segment_efforts) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

export async function setCachedSegmentEfforts(activityId: number, efforts: unknown[]) {
  await query("UPDATE activities SET segment_efforts = $1 WHERE id = $2", [
    JSON.stringify(efforts),
    activityId,
  ]);
}

export async function listSportTypes(): Promise<string[]> {
  const rows = await query<{ sport_type: string }>(
    "SELECT DISTINCT sport_type FROM activities ORDER BY sport_type",
  );
  return rows.map((row) => row.sport_type);
}
