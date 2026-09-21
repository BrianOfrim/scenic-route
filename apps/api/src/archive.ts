import { gunzipSync, unzipSync } from "fflate";
import { ImportError } from "./gpx";

const TRACK_EXT = /\.(gpx|fit|tcx)(\.gz)?$/i;
const GZIP_MAGIC = [0x1f, 0x8b];
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_TRACK_BYTES = 64 * 1024 * 1024;

export type ArchiveTrack = {
  origin: "upload" | "archive";
  filename: string;
  bytes: Uint8Array;
  externalId: number | null;
  name: string | null;
  type: string | null;
  startDate: string | null;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  elevationGain: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
};

export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

export function expandImportArchive(bytes: Uint8Array, zipName = "export.zip"): ArchiveTrack[] {
  if (!isZipBytes(bytes)) throw new ImportError("This file is not a zip archive");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new ImportError("This zip archive is too large");

  let entries: Record<string, Uint8Array>;
  try {
    let entryCount = 0;
    let expandedBytes = 0;
    entries = unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          throw new ImportError("This zip archive contains too many files");
        }
        const path = entry.name.replace(/\\/g, "/");
        const wanted = TRACK_EXT.test(path) || path.split("/").pop()?.toLowerCase() === "activities.csv";
        if (!wanted) return false;
        if (entry.originalSize > MAX_TRACK_BYTES && TRACK_EXT.test(path)) {
          throw new ImportError(`${basename(path)} is too large to import`);
        }
        expandedBytes += entry.originalSize;
        if (expandedBytes > MAX_EXPANDED_BYTES) {
          throw new ImportError("This zip archive expands beyond the import limit");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("Could not read this zip archive");
  }

  const files = new Map<string, Uint8Array>();
  for (const [rawPath, data] of Object.entries(entries)) {
    const path = rawPath.replace(/\\/g, "/");
    if (!data?.length) continue;
    if (path.endsWith("/")) continue;
    if (path.includes("__MACOSX/") || /(^|\/)\./.test(path)) continue;
    files.set(path, data);
  }

  const csvPath = [...files.keys()].find((path) => path.split("/").pop()?.toLowerCase() === "activities.csv");
  const tracks = csvPath ? tracksFromCsv(files, csvPath) : tracksFromFiles(files);

  if (!tracks.length) {
    throw new ImportError(
      zipName.toLowerCase().includes("export")
        ? "This account export has no GPX, FIT, or TCX activities"
        : "This zip has no GPX, FIT, or TCX files",
    );
  }
  return tracks;
}

export function maybeGunzip(bytes: Uint8Array, filename: string): Uint8Array {
  const gzipped =
    TRACK_EXT.test(filename) && filename.toLowerCase().endsWith(".gz")
      ? true
      : bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  if (!gzipped) return bytes;
  try {
    return gunzipSync(bytes);
  } catch {
    throw new ImportError(`${basename(filename)} is not valid gzip`);
  }
}

export function parseActivitiesCsv(text: string): Array<{
  id: number | null;
  name: string | null;
  type: string | null;
  startDate: string | null;
  filename: string | null;
  distance: number | null;
  movingTime: number | null;
  elapsedTime: number | null;
  elevationGain: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
}> {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/\s+/g, " "));
  const col = (name: string) => headers.indexOf(name);
  const cols = (name: string) => headers.flatMap((header, index) => (header === name ? [index] : []));
  const idCol = col("activity id");
  const nameCol = col("activity name");
  const typeCol = col("activity type") >= 0 ? col("activity type") : col("sport type");
  const dateCol = col("activity date");
  const fileCol = col("filename");
  const distanceCols = cols("distance");
  const elapsedCols = cols("elapsed time");
  const movingCols = cols("moving time");
  const elevationCols = cols("elevation gain");
  const averageSpeedCols = cols("average speed");
  const maxSpeedCols = cols("max speed");
  if (fileCol < 0 && idCol < 0) return [];

  return rows.slice(1).map((row) => ({
    id: parseExternalId(row[idCol] ?? ""),
    name: emptyToNull(row[nameCol] ?? ""),
    type: emptyToNull(row[typeCol] ?? ""),
    startDate: parseCsvDate(row[dateCol] ?? ""),
    filename: emptyToNull((row[fileCol] ?? "").replace(/\\/g, "/")),
    distance: lastNumber(row, distanceCols),
    movingTime: lastNumber(row, movingCols),
    elapsedTime: lastNumber(row, elapsedCols),
    elevationGain: lastNumber(row, elevationCols),
    averageSpeed: lastNumber(row, averageSpeedCols),
    maxSpeed: lastNumber(row, maxSpeedCols),
  }));
}

function tracksFromCsv(files: Map<string, Uint8Array>, csvPath: string): ArchiveTrack[] {
  const rows = parseActivitiesCsv(new TextDecoder().decode(files.get(csvPath)));
  const dir = dirname(csvPath);
  const byBase = indexByBasename(files);
  const tracks: ArchiveTrack[] = [];

  for (const row of rows) {
    if (!row.filename) continue;
    const data = lookupZipFile(files, byBase, dir, row.filename);
    if (!data) continue;
    const filename = basename(row.filename);
    tracks.push({
      origin: "archive",
      filename,
      bytes: maybeGunzip(data, filename),
      externalId: row.id ?? parseExternalId(filename),
      name: row.name,
      type: row.type,
      startDate: row.startDate,
      distance: row.distance,
      movingTime: row.movingTime,
      elapsedTime: row.elapsedTime,
      elevationGain: row.elevationGain,
      averageSpeed: row.averageSpeed,
      maxSpeed: row.maxSpeed,
    });
  }
  return tracks;
}

function tracksFromFiles(files: Map<string, Uint8Array>): ArchiveTrack[] {
  const tracks: ArchiveTrack[] = [];
  for (const [path, data] of files) {
    if (!TRACK_EXT.test(path)) continue;
    const filename = basename(path);
    tracks.push({
      origin: "archive",
      filename,
      bytes: maybeGunzip(data, filename),
      externalId: parseExternalId(filename),
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
  }
  return tracks;
}

function lookupZipFile(
  files: Map<string, Uint8Array>,
  byBase: Map<string, Uint8Array>,
  csvDir: string,
  filename: string,
): Uint8Array | undefined {
  const rel = filename.replace(/^\.\//, "");
  return (
    files.get(rel) ??
    files.get(`${csvDir}/${rel}`.replace(/^\//, "")) ??
    files.get(`${csvDir}/${basename(rel)}`.replace(/^\//, "")) ??
    byBase.get(basename(rel).toLowerCase())
  );
}

function indexByBasename(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const index = new Map<string, Uint8Array>();
  for (const [path, data] of files) index.set(basename(path).toLowerCase(), data);
  return index;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

function parseExternalId(value: string): number | null {
  const base = value.replace(/^.*[/\\]/, "").replace(/\.(gpx|fit|tcx)(\.gz)?$/i, "");
  if (!/^\d+$/.test(base)) return null;
  const id = Number(base);
  return Number.isSafeInteger(id) && id > 0 && id < 2_000_000_000_000 ? id : null;
}

function lastNumber(row: string[], indexes: number[]): number | null {
  for (let i = indexes.length - 1; i >= 0; i -= 1) {
    const raw = row[indexes[i]]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseCsvDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyToNull(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function basename(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

function dirname(path: string): string {
  const index = path.replace(/\\/g, "/").lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
