import { Decoder, Stream } from "@garmin/fitsdk";
import { ImportError, type ParsedGpx } from "./gpx";

const SEMI_TO_DEG = 180 / 2_147_483_648;
const INVALID_SEMI = 0x7fffffff;

export class FitError extends ImportError {
  constructor(message: string) {
    super(message);
    this.name = "FitError";
  }
}

export function isFitBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  );
}

export function parseFit(bytes: Uint8Array): ParsedGpx {
  if (!isFitBytes(bytes)) throw new FitError("This file is not a FIT activity");

  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new FitError("This file is not a FIT activity");

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: false,
  });

  const records = messages.recordMesgs ?? [];
  const coursePoints = messages.coursePointMesgs ?? [];
  const points = (records.length ? records : coursePoints)
    .map((record) => {
      const lat = toDegrees(record.positionLat, 90);
      const lng = toDegrees(record.positionLong, 180);
      if (lat == null || lng == null) return null;
      return {
        lat,
        lng,
        ele: finiteNumber(record.enhancedAltitude ?? record.altitude),
        time: toDate(record.timestamp),
      };
    })
    .filter((point): point is NonNullable<typeof point> => point != null);

  if (points.length < 2) {
    const detail = errors[0]?.message;
    throw new FitError(detail || "FIT file needs at least two GPS points");
  }

  const session = messages.sessionMesgs?.[0];
  const sportMesg = messages.sportMesgs?.[0];
  const workout = messages.workoutMesgs?.[0];
  const course = messages.courseMesgs?.[0];
  const type = fitSportName(session?.sport ?? sportMesg?.sport ?? course?.sport, session?.subSport ?? sportMesg?.subSport ?? course?.subSport);
  const name = stringField(workout?.wktName) ?? stringField(course?.name) ?? stringField(sportMesg?.name);
  const startDate = points.find((point) => point.time)?.time ?? toDate(session?.startTime);

  return { name, type, startDate, points };
}

export function fitSportName(sport: unknown, subSport: unknown): string | null {
  const main = normalize(sport);
  const sub = normalize(subSport);
  if (!main) return null;
  if (main === "cycling" || main === "ebiking") {
    if (sub === "mountain" || sub === "downhill") return "mountainbikeride";
    if (sub === "gravelcycling" || sub === "gravel") return "gravelride";
    if (sub === "ebikefitness" || main === "ebiking") return "ebikeride";
  }
  if (main === "running" && sub === "trail") return "trailrun";
  return main;
}

function toDegrees(value: unknown, maxAbs: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) === INVALID_SEMI) return null;
  const deg = Math.abs(n) <= 180 ? n : n * SEMI_TO_DEG;
  if (!Number.isFinite(deg) || Math.abs(deg) > maxAbs) return null;
  return deg;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000 + 631_065_600_000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}
