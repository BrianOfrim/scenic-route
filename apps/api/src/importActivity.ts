import { expandImportArchive, isZipBytes, maybeGunzip, type ArchiveTrack } from "./archive";
import { getActivity, parseLatLng, toActivitySummary, type ActivityRow, type ActivitySource, type ActivitySummary } from "./activities";
import { query, queryOne, withTransaction, type SqlClient } from "./db";
import { isFitBytes, parseFit } from "./fit";
import { gpxToActivityFields, mapSport, parseGpx, ImportError, type GpxActivityFields } from "./gpx";
import { isTcxXml, parseTcx } from "./tcx";

export const IMPORTED_ID_BASE = 2_000_000_000_000;

export type ImportFile = {
  filename: string;
  bytes: Uint8Array;
};

export type ImportResult = {
  activities: ActivitySummary[];
  errors: Array<{ filename: string; error: string }>;
  skipped: number;
};

export async function importTrackFiles(userId: string, files: ImportFile[]): Promise<ImportResult> {
  return withTransaction(async (client) => {
    const activities: ActivitySummary[] = [];
    const errors: Array<{ filename: string; error: string }> = [];
    let skipped = 0;
    for (const file of expandUploads(files)) {
      try {
        const imported = await insertImportedTrack(userId, file, file.filename, client);
        if (imported === "skipped") skipped += 1;
        else activities.push(imported);
      } catch (error) {
        errors.push({
          filename: file.filename || "upload",
          error: error instanceof Error ? error.message : "import failed",
        });
      }
    }
    return { activities, errors, skipped };
  });
}

export async function insertImportedTrack(
  userId: string,
  bytesOrFile: Uint8Array | ArchiveTrack,
  filename = "upload",
  client?: SqlClient,
): Promise<ActivitySummary | "skipped"> {
  const file: ArchiveTrack =
    bytesOrFile instanceof Uint8Array
      ? {
          filename,
          bytes: maybeGunzip(bytesOrFile, filename),
          stravaId: null,
          name: null,
          type: null,
          startDate: null,
        }
      : bytesOrFile;
  const source = detectSource(file.bytes, file.filename);
  const parsed =
    source === "fit"
      ? parseFit(file.bytes)
      : source === "tcx"
        ? parseTcx(bytesToText(file.bytes))
        : parseGpx(bytesToText(file.bytes));
  const fields = overlayArchiveMeta(gpxToActivityFields(parsed, file.filename), file);
  return insertImportedFields(userId, fields, file.stravaId ? "strava" : source, file.stravaId, client);
}

export function overlayArchiveMeta(fields: GpxActivityFields, meta: Pick<ArchiveTrack, "name" | "type" | "startDate">): GpxActivityFields {
  const sport = meta.type ? mapSport(meta.type) : { type: fields.type, sport: fields.sportType };
  return {
    ...fields,
    name: meta.name?.trim() || fields.name,
    type: sport.type,
    sportType: sport.sport,
    startDate: meta.startDate || fields.startDate,
  };
}

function detectSource(bytes: Uint8Array, filename: string): Exclude<ActivitySource, "strava"> {
  if (isFitBytes(bytes)) return "fit";
  const text = bytesToText(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (looksLikeGpx(text)) return "gpx";
  if (isTcxXml(text)) return "tcx";
  const ext = filename.toLowerCase().replace(/\.gz$/, "");
  if (ext.endsWith(".fit")) return "fit";
  if (ext.endsWith(".gpx")) return "gpx";
  if (ext.endsWith(".tcx")) return "tcx";
  throw new ImportError("Upload a GPX, FIT, TCX, or a Strava export zip");
}

function expandUploads(files: ImportFile[]): ArchiveTrack[] {
  const tracks: ArchiveTrack[] = [];
  for (const file of files) {
    if (isZipBytes(file.bytes) || file.filename.toLowerCase().endsWith(".zip")) {
      tracks.push(...expandImportArchive(file.bytes, file.filename));
      continue;
    }
    tracks.push({
      filename: file.filename,
      bytes: maybeGunzip(file.bytes, file.filename),
      stravaId: null,
      name: null,
      type: null,
      startDate: null,
    });
  }
  return tracks;
}

function looksLikeGpx(xml: string): boolean {
  return /<(?:[\w.-]+:)?gpx\b/i.test(xml);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
}

async function insertImportedFields(
  userId: string,
  fields: GpxActivityFields,
  source: ActivitySource,
  preferredId?: number | null,
  client?: SqlClient,
): Promise<ActivitySummary | "skipped"> {
  const id = preferredId && preferredId > 0 ? preferredId : await nextImportedId(userId, client);
  const existing = preferredId && preferredId > 0 ? await getActivity(userId, preferredId, client) : null;
  if (existing) {
    if (hasSyncedGps(existing)) return "skipped";
    await query(
      `UPDATE activities SET
         distance = $1, moving_time = $2, elapsed_time = $3, total_elevation_gain = $4,
         average_speed = $5, max_speed = $6, has_gps = 1, streams_synced = 1, imported = 1,
         latlng = $7, "time" = $8, velocity = $9, altitude = $10, bbox = $11
       WHERE user_id = $12 AND id = $13`,
      [
        fields.distance,
        fields.movingTime,
        fields.elapsedTime,
        fields.elevationGain,
        fields.averageSpeed,
        fields.maxSpeed,
        JSON.stringify(fields.latlng),
        fields.time ? JSON.stringify(fields.time) : null,
        fields.velocity ? JSON.stringify(fields.velocity) : null,
        fields.altitude ? JSON.stringify(fields.altitude) : null,
        JSON.stringify(fields.bbox),
        userId,
        existing.id,
      ],
      client,
    );
    const updated = await getActivity(userId, existing.id, client);
    if (!updated) throw new Error("imported activity was not saved");
    return toActivitySummary(updated);
  }
  await query(
    `INSERT INTO activities (
       user_id, id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
       total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced,
       latlng, "time", velocity, altitude, bbox, source, imported
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 1, 1, $13, $14, $15, $16, $17, $18, 1)`,
    [
      userId,
      id,
      fields.name,
      fields.type,
      fields.sportType,
      fields.startDate,
      fields.distance,
      fields.movingTime,
      fields.elapsedTime,
      fields.elevationGain,
      fields.averageSpeed,
      fields.maxSpeed,
      JSON.stringify(fields.latlng),
      fields.time ? JSON.stringify(fields.time) : null,
      fields.velocity ? JSON.stringify(fields.velocity) : null,
      fields.altitude ? JSON.stringify(fields.altitude) : null,
      JSON.stringify(fields.bbox),
      source,
    ],
    client,
  );
  const row = await queryOne<ActivityRow>(
    "SELECT * FROM activities WHERE user_id = $1 AND id = $2",
    [userId, id],
    client,
  );
  if (!row) throw new Error("imported activity was not saved");
  return toActivitySummary(row);
}

function hasSyncedGps(row: ActivityRow): boolean {
  return row.streams_synced === 1 && parseLatLng(row.latlng).length >= 2;
}

async function nextImportedId(userId: string, client?: SqlClient): Promise<number> {
  const row = await queryOne<{ maxId: number | null }>(
    `SELECT MAX(id) AS "maxId" FROM activities WHERE user_id = $1 AND id >= $2`,
    [userId, IMPORTED_ID_BASE],
    client,
  );
  return (row?.maxId ?? IMPORTED_ID_BASE - 1) + 1;
}
