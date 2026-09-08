import type { FeatureCollection, LineString } from "geojson";
import { getDb } from "./db";

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
};

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
};

export function listActivities(): ActivitySummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, type, sport_type, start_date, distance, moving_time, elapsed_time,
              total_elevation_gain, average_speed, has_gps, streams_synced
       FROM activities
       ORDER BY start_date DESC`,
    )
    .all() as Array<
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
    >
  >;

  return rows.map((row) => ({
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
  }));
}

export function getActivity(id: number): ActivityRow | null {
  return (
    (getDb().prepare("SELECT * FROM activities WHERE id = ?").get(id) as ActivityRow | undefined) ??
    null
  );
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

export function setCachedSegmentEfforts(activityId: number, efforts: unknown[]) {
  getDb()
    .prepare("UPDATE activities SET segment_efforts = ? WHERE id = ?")
    .run(JSON.stringify(efforts), activityId);
}

export function listSportTypes(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT sport_type FROM activities ORDER BY sport_type")
    .all() as { sport_type: string }[];
  return rows.map((row) => row.sport_type);
}
