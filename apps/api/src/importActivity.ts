import { createHash } from "node:crypto";
import { expandImportArchive, isZipBytes, maybeGunzip, type ArchiveTrack } from "./archive";
import { toActivitySummary, type ActivityFormat, type ActivityOrigin, type ActivityRow, type ActivitySummary } from "./activities";
import { query, queryOne, type SqlClient } from "./db";
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
  const activities: ActivitySummary[] = [];
  const expanded = expandUploads(files);
  const errors = [...expanded.errors];
  let skipped = 0;
  for (const file of expanded.tracks) {
    try {
      const imported = await insertImportedTrack(userId, file, file.filename);
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
          origin: "upload",
          filename,
          bytes: maybeGunzip(bytesOrFile, filename),
          externalId: null,
          name: null,
          type: null,
          startDate: null,
          distance: null,
          movingTime: null,
          elapsedTime: null,
          elevationGain: null,
          averageSpeed: null,
          maxSpeed: null,
        }
      : bytesOrFile;
  const format = detectFormat(file.bytes, file.filename);
  const parsed =
    format === "fit"
      ? parseFit(file.bytes)
      : format === "tcx"
        ? parseTcx(bytesToText(file.bytes))
        : parseGpx(bytesToText(file.bytes));
  const fields = overlayArchiveMeta(gpxToActivityFields(parsed, file.filename), file);
  return insertImportedFields(
    userId,
    fields,
    file.origin,
    format,
    file.externalId,
    contentHash(file.bytes),
    client,
  );
}

export function overlayArchiveMeta(
  fields: GpxActivityFields,
  meta: Pick<
    ArchiveTrack,
    | "name"
    | "type"
    | "startDate"
    | "distance"
    | "movingTime"
    | "elapsedTime"
    | "elevationGain"
    | "averageSpeed"
    | "maxSpeed"
  >,
): GpxActivityFields {
  const sport = meta.type ? mapSport(meta.type) : { type: fields.type, sport: fields.sportType };
  return {
    ...fields,
    name: meta.name?.trim() || fields.name,
    type: sport.type,
    sportType: sport.sport,
    startDate: meta.startDate || fields.startDate,
    distance: meta.distance ?? fields.distance,
    movingTime: meta.movingTime ?? fields.movingTime,
    elapsedTime: meta.elapsedTime ?? fields.elapsedTime,
    elevationGain: meta.elevationGain ?? fields.elevationGain,
    averageSpeed: meta.averageSpeed ?? fields.averageSpeed,
    maxSpeed: meta.maxSpeed ?? fields.maxSpeed,
  };
}

function detectFormat(bytes: Uint8Array, filename: string): ActivityFormat {
  if (isFitBytes(bytes)) return "fit";
  const text = bytesToText(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (looksLikeGpx(text)) return "gpx";
  if (isTcxXml(text)) return "tcx";
  const ext = filename.toLowerCase().replace(/\.gz$/, "");
  if (ext.endsWith(".fit")) return "fit";
  if (ext.endsWith(".gpx")) return "gpx";
  if (ext.endsWith(".tcx")) return "tcx";
  throw new ImportError("Upload a GPX, FIT, TCX, or account export zip");
}

function expandUploads(files: ImportFile[]): {
  tracks: ArchiveTrack[];
  errors: Array<{ filename: string; error: string }>;
} {
  const tracks: ArchiveTrack[] = [];
  const errors: Array<{ filename: string; error: string }> = [];
  for (const file of files) {
    const filename = file.filename || "upload";
    try {
      if (isZipBytes(file.bytes) || filename.toLowerCase().endsWith(".zip")) {
        tracks.push(...expandImportArchive(file.bytes, filename));
        continue;
      }
      tracks.push({
        origin: "upload",
        filename,
        bytes: maybeGunzip(file.bytes, filename),
        externalId: null,
        name: null,
        type: null,
        startDate: null,
        distance: null,
        movingTime: null,
        elapsedTime: null,
        elevationGain: null,
        averageSpeed: null,
        maxSpeed: null,
      });
    } catch (error) {
      errors.push({
        filename,
        error: error instanceof Error ? error.message : "import failed",
      });
    }
  }
  return { tracks, errors };
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
  origin: ActivityOrigin,
  format: ActivityFormat,
  preferredId?: number | null,
  hash?: string,
  client?: SqlClient,
): Promise<ActivitySummary | "skipped"> {
  const duplicate = hash
    ? await queryOne<ActivityRow>(
        "SELECT * FROM activities WHERE user_id = $1 AND content_hash = $2 AND imported = 1",
        [userId, hash],
        client,
      )
    : null;
  if (duplicate) return "skipped";
  const id = preferredId && preferredId > 0 ? preferredId : await nextImportedId(userId, client);
  const existing = preferredId && preferredId > 0
    ? await queryOne<ActivityRow>("SELECT * FROM activities WHERE user_id = $1 AND id = $2", [userId, preferredId], client)
    : null;
  if (existing) {
    if (existing.imported === 1) return "skipped";
    await query(
      `UPDATE activities SET
         name = $1, "type" = $2, sport_type = $3, start_date = $4,
         distance = $5, moving_time = $6, elapsed_time = $7, total_elevation_gain = $8,
         average_speed = $9, max_speed = $10, has_gps = 1, streams_synced = 1, imported = 1,
         latlng = $11, "time" = $12, velocity = $13, altitude = $14, bbox = $15,
         source = $16, origin = $17, file_format = $18, external_id = $19, content_hash = $20,
         segment_efforts = NULL
       WHERE user_id = $21 AND id = $22`,
      [
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
        format,
        origin,
        format,
        preferredId ? String(preferredId) : null,
        hash ?? null,
        userId,
        existing.id,
      ],
      client,
    );
    const updated = await queryOne<ActivityRow>(
      "SELECT * FROM activities WHERE user_id = $1 AND id = $2",
      [userId, existing.id],
      client,
    );
    if (!updated) throw new Error("imported activity was not saved");
    return toActivitySummary(updated);
  }
  await query(
    `INSERT INTO activities (
       user_id, id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
       total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced,
       latlng, "time", velocity, altitude, bbox, source, imported,
       origin, file_format, external_id, content_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 1, 1,
       $13, $14, $15, $16, $17, $18, 1, $19, $20, $21, $22)`,
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
      format,
      origin,
      format,
      preferredId ? String(preferredId) : null,
      hash ?? null,
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

function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function nextImportedId(userId: string, client?: SqlClient): Promise<number> {
  const row = await queryOne<{ maxId: number | null }>(
    `SELECT MAX(id) AS "maxId" FROM activities WHERE user_id = $1 AND id >= $2`,
    [userId, IMPORTED_ID_BASE],
    client,
  );
  return (row?.maxId ?? IMPORTED_ID_BASE - 1) + 1;
}
