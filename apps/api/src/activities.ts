import type { FeatureCollection, LineString } from "geojson";
import { query, queryOne, withTransaction, type SqlClient } from "./db";
import { rememberActivityFile, rememberImportedId } from "./importedIds";

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
  route_breaks?: string | null;
  time: string | null;
  velocity: string | null;
  altitude: string | null;
  bbox: string | null;
  segment_efforts?: string | null;
  source?: string | null;
  imported?: number | null;
  origin?: string | null;
  file_format?: string | null;
  external_id?: string | null;
  content_hash?: string | null;
};

export type ActivityOrigin = "upload" | "archive";
export type ActivityFormat = "gpx" | "fit" | "tcx";

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
  origin: ActivityOrigin;
  format: ActivityFormat;
  imported: boolean;
};

export function activityOrigin(value: string | null | undefined): ActivityOrigin {
  return value === "archive" ? "archive" : "upload";
}

export function activityFormat(value: string | null | undefined, legacySource?: string | null): ActivityFormat {
  const candidate = value ?? legacySource;
  return candidate === "fit" || candidate === "tcx" ? candidate : "gpx";
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
    | "origin"
    | "file_format"
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
    origin: activityOrigin(row.origin),
    format: activityFormat(row.file_format, row.source),
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

export async function listActivities(userId: string): Promise<ActivitySummary[]> {
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
      | "origin"
      | "file_format"
    >
  >(
    `SELECT id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
            total_elevation_gain, average_speed, has_gps, streams_synced, source, imported,
            origin, file_format
     FROM activities
     WHERE user_id = $1 AND imported = 1
     ORDER BY start_date DESC`,
    [userId],
  );

  return rows.map(toActivitySummary);
}

export async function getActivity(
  userId: string,
  id: number,
  client?: SqlClient,
): Promise<ActivityRow | null> {
  return (
    (await queryOne<ActivityRow>("SELECT * FROM activities WHERE user_id = $1 AND id = $2 AND imported = 1", [userId, id], client)) ??
    null
  );
}

export async function deleteImportedByIds(
  userId: string,
  ids: number[],
): Promise<{ deleted: ActivitySummary[]; skipped: number }> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  return withTransaction(async (client) => {
    const deleted: ActivitySummary[] = [];
    let skipped = 0;
    for (const id of unique) {
      const row = await getActivity(userId, id, client);
      if (!row) continue;
      if (!isImported(row)) {
        skipped += 1;
        continue;
      }
      await rememberImportedId(userId, id, client);
      if (row.content_hash) await rememberActivityFile(userId, row.content_hash, id, client);
      await query("DELETE FROM activities WHERE user_id = $1 AND id = $2", [userId, id], client);
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
    features: splitTrack(points, parseNumberArray(row.route_breaks ?? null)).filter((segment) => segment.length >= 2).map((segment) => ({
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
          coordinates: segment.map(([lat, lng]) => [lng, lat]),
        },
      })),
  };
}

export function splitTrack(points: [number, number][], breaks: number[]): [number, number][][] {
  const starts = [0, ...breaks.filter((index) => Number.isInteger(index) && index > 0 && index < points.length).sort((a, b) => a - b), points.length];
  return starts.slice(0, -1).map((start, i) => points.slice(start, starts[i + 1]));
}

export async function listSportTypes(userId: string): Promise<string[]> {
  const rows = await query<{ sport_type: string }>(
    "SELECT DISTINCT sport_type FROM activities WHERE user_id = $1 ORDER BY sport_type",
    [userId],
  );
  return rows.map((row) => row.sport_type);
}
