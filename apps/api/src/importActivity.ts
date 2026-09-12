import { expandImportArchive, isZipBytes, maybeGunzip, type ArchiveTrack } from "./archive";
import { getActivity, parseLatLng, toActivitySummary, type ActivityRow, type ActivitySource, type ActivitySummary } from "./activities";
import { getDb } from "./db";
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

export function importTrackFiles(files: ImportFile[]): ImportResult {
  const activities: ActivitySummary[] = [];
  const errors: Array<{ filename: string; error: string }> = [];
  let skipped = 0;
  const insert = getDb().transaction((batch: ImportFile[]) => {
    for (const file of expandUploads(batch)) {
      try {
        const imported = insertImportedTrack(file);
        if (imported === "skipped") skipped += 1;
        else activities.push(imported);
      } catch (error) {
        errors.push({
          filename: file.filename || "upload",
          error: error instanceof Error ? error.message : "import failed",
        });
      }
    }
  });
  insert(files);
  return { activities, errors, skipped };
}

export function insertImportedTrack(
  bytesOrFile: Uint8Array | ArchiveTrack,
  filename = "upload",
): ActivitySummary | "skipped" {
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
  return insertImportedFields(fields, file.stravaId ? "strava" : source, file.stravaId);
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

function insertImportedFields(
  fields: GpxActivityFields,
  source: ActivitySource,
  preferredId?: number | null,
): ActivitySummary | "skipped" {
  const id = preferredId && preferredId > 0 ? preferredId : nextImportedId();
  const existing = preferredId && preferredId > 0 ? getActivity(preferredId) : null;
  if (existing) {
    if (hasSyncedGps(existing)) return "skipped";
    getDb()
      .prepare(
        `UPDATE activities SET
           distance = ?, moving_time = ?, elapsed_time = ?, total_elevation_gain = ?,
           average_speed = ?, max_speed = ?, has_gps = 1, streams_synced = 1, imported = 1,
           latlng = ?, time = ?, velocity = ?, altitude = ?, bbox = ?
         WHERE id = ?`,
      )
      .run(
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
        existing.id,
      );
    const updated = getActivity(existing.id);
    if (!updated) throw new Error("imported activity was not saved");
    return toActivitySummary(updated);
  }
  getDb()
    .prepare(
      `INSERT INTO activities (
         id, name, type, sport_type, start_date, distance, moving_time, elapsed_time,
         total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced,
         latlng, time, velocity, altitude, bbox, source, imported
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
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
    );
  const row = getDb().prepare("SELECT * FROM activities WHERE id = ?").get(id) as ActivityRow | undefined;
  if (!row) throw new Error("imported activity was not saved");
  return toActivitySummary(row);
}

function hasSyncedGps(row: ActivityRow): boolean {
  return row.streams_synced === 1 && parseLatLng(row.latlng).length >= 2;
}

function nextImportedId(): number {
  const row = getDb()
    .prepare("SELECT MAX(id) as maxId FROM activities WHERE id >= ?")
    .get(IMPORTED_ID_BASE) as { maxId: number | null };
  return (row.maxId ?? IMPORTED_ID_BASE - 1) + 1;
}
