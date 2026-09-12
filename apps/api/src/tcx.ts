import { ImportError, type ParsedGpx } from "./gpx";

export class TcxError extends ImportError {
  constructor(message: string) {
    super(message);
    this.name = "TcxError";
  }
}

const TRACKPOINT_RE =
  /<(?:[\w.-]+:)?Trackpoint\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Trackpoint\s*>/gi;
const ACTIVITY_RE =
  /<(?:[\w.-]+:)?Activity\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Activity\s*>/gi;
const COURSE_RE =
  /<(?:[\w.-]+:)?Course\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Course\s*>/gi;

export function parseTcx(xml: string): ParsedGpx {
  const source = xml.replace(/^\uFEFF/, "");
  if (!isTcxXml(source)) throw new TcxError("This file is not a TCX activity");

  const activities = [...source.matchAll(ACTIVITY_RE)].map((match) => ({
    sport: attr(match[1], "Sport"),
    body: match[2],
  }));
  const courses = [...source.matchAll(COURSE_RE)].map((match) => match[1]);

  let points = activities.flatMap((activity) => parseTrackpoints(activity.body));
  let type = activities.find((activity) => activity.sport)?.sport ?? null;
  let name =
    activities.map((activity) => childText(activity.body, "Notes")).find(Boolean) ?? null;

  if (points.length < 2) {
    points = courses.flatMap((body) => parseTrackpoints(body));
    name = name ?? courses.map((body) => childText(body, "Name")).find(Boolean) ?? null;
    type = type ?? courses.map((body) => childText(body, "Sport")).find(Boolean) ?? null;
  }

  if (points.length < 2) throw new TcxError("TCX file needs at least two GPS points");

  const startDate =
    points.find((point) => point.time)?.time ??
    parseTime(activities.map((activity) => childText(activity.body, "Id")).find(Boolean) ?? null);

  return { name, type, startDate, points };
}

export function isTcxXml(xml: string): boolean {
  return /<(?:[\w.-]+:)?(?:TrainingCenterDatabase|Activity|Course)\b/i.test(xml);
}

function parseTrackpoints(xml: string): ParsedGpx["points"] {
  const points: ParsedGpx["points"] = [];
  TRACKPOINT_RE.lastIndex = 0;
  for (const match of xml.matchAll(TRACKPOINT_RE)) {
    const body = match[1] ?? "";
    const position = firstBlock(body, "Position");
    const latRaw = position ? childText(position, "LatitudeDegrees") : null;
    const lngRaw = position ? childText(position, "LongitudeDegrees") : null;
    const lat = latRaw != null ? Number(latRaw) : NaN;
    const lng = lngRaw != null ? Number(lngRaw) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const eleRaw = childText(body, "AltitudeMeters");
    const ele = eleRaw != null ? Number(eleRaw) : null;
    points.push({
      lat,
      lng,
      ele: ele != null && Number.isFinite(ele) ? ele : null,
      time: parseTime(childText(body, "Time")),
    });
  }
  return points;
}

function firstBlock(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, "i");
  const match = xml.match(re);
  return match ? match[1] : null;
}

function childText(xml: string, name: string): string | null {
  if (!xml) return null;
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, "i");
  const match = xml.match(re);
  if (!match) return null;
  const text = decodeXml(match[1]).replace(/<[^>]+>/g, "").trim();
  return text || null;
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = attrs.match(re);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function parseTime(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}
