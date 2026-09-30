import { bboxFromLatLng, haversineM, type LatLng } from "./geo";
import { stitchTrackSegments, trackDistanceWithBreaks } from "./trackSegments";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export class GpxError extends ImportError {
  constructor(message: string) {
    super(message);
    this.name = "GpxError";
  }
}

export type GpxPoint = {
  lat: number;
  lng: number;
  ele: number | null;
  time: Date | null;
};

export type ParsedGpx = {
  name: string | null;
  type: string | null;
  startDate: Date | null;
  points: GpxPoint[];
  segments?: GpxPoint[][];
};

export type GpxActivityFields = {
  name: string;
  type: string;
  sportType: string;
  startDate: string;
  distance: number;
  movingTime: number | null;
  elapsedTime: number | null;
  elevationGain: number | null;
  averageSpeed: number | null;
  maxSpeed: number | null;
  latlng: LatLng[];
  routeBreaks: number[];
  time: number[] | null;
  velocity: number[] | null;
  altitude: number[] | null;
  bbox: [number, number, number, number];
};

const SPORT_MAP: Record<string, { type: string; sport: string }> = {
  cycling: { type: "Ride", sport: "Ride" },
  biking: { type: "Ride", sport: "Ride" },
  ride: { type: "Ride", sport: "Ride" },
  bike: { type: "Ride", sport: "Ride" },
  bicycle: { type: "Ride", sport: "Ride" },
  mountainbikeride: { type: "Ride", sport: "MountainBikeRide" },
  mountainbike: { type: "Ride", sport: "MountainBikeRide" },
  mtb: { type: "Ride", sport: "MountainBikeRide" },
  gravelride: { type: "Ride", sport: "GravelRide" },
  gravel: { type: "Ride", sport: "GravelRide" },
  ebiride: { type: "Ride", sport: "EBikeRide" },
  ebikeride: { type: "Ride", sport: "EBikeRide" },
  ebike: { type: "Ride", sport: "EBikeRide" },
  virtualride: { type: "Ride", sport: "VirtualRide" },
  other: { type: "Ride", sport: "Ride" },
  running: { type: "Run", sport: "Run" },
  run: { type: "Run", sport: "Run" },
  trailrun: { type: "Run", sport: "TrailRun" },
  trailrunning: { type: "Run", sport: "TrailRun" },
  hiking: { type: "Hike", sport: "Hike" },
  hike: { type: "Hike", sport: "Hike" },
  walking: { type: "Walk", sport: "Walk" },
  walk: { type: "Walk", sport: "Walk" },
  swimming: { type: "Swim", sport: "Swim" },
  swim: { type: "Swim", sport: "Swim" },
  alpineski: { type: "AlpineSki", sport: "AlpineSki" },
  downhillski: { type: "AlpineSki", sport: "AlpineSki" },
  nordicski: { type: "NordicSki", sport: "NordicSki" },
  snowboard: { type: "Snowboard", sport: "Snowboard" },
  kayaking: { type: "Kayaking", sport: "Kayaking" },
  kayak: { type: "Kayaking", sport: "Kayaking" },
  paddling: { type: "Kayaking", sport: "Kayaking" },
  canoeing: { type: "Canoeing", sport: "Canoeing" },
  rowing: { type: "Rowing", sport: "Rowing" },
  windsurfing: { type: "Windsurf", sport: "Windsurf" },
  windsurf: { type: "Windsurf", sport: "Windsurf" },
  kitesurfing: { type: "Kitesurf", sport: "Kitesurf" },
  kitesurf: { type: "Kitesurf", sport: "Kitesurf" },
  standuppaddleboarding: { type: "StandUpPaddling", sport: "StandUpPaddling" },
  standuppaddling: { type: "StandUpPaddling", sport: "StandUpPaddling" },
  crosscountryskiing: { type: "NordicSki", sport: "NordicSki" },
  nordicskiing: { type: "NordicSki", sport: "NordicSki" },
  alpineskiing: { type: "AlpineSki", sport: "AlpineSki" },
  snowboarding: { type: "Snowboard", sport: "Snowboard" },
  iceskating: { type: "IceSkate", sport: "IceSkate" },
  golf: { type: "Golf", sport: "Golf" },
  ebiking: { type: "Ride", sport: "EBikeRide" },
};

const POINT_RE =
  /<(?:[\w.-]+:)?(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>)/gi;
const ELE_NOISE_M = 1;
const MOVING_SPEED_MS = 0.3;

export function parseGpx(xml: string): ParsedGpx {
  const source = stripBom(xml);
  if (!/<(?:[\w.-]+:)?gpx\b/i.test(source)) {
    throw new GpxError("This file is not a GPX track");
  }

  const track = firstBlock(source, "trk");
  const route = firstBlock(source, "rte");
  const metadata = firstBlock(source, "metadata");
  const pointSource = track || route || source;
  const segments = track ? [...source.matchAll(/<(?:[\w.-]+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?trkseg\s*>/gi)]
    .map((match) => parsePoints(match[1])) : [];
  const points = segments.length ? segments.flat() : parsePoints(pointSource);
  if (points.length < 2) {
    throw new GpxError("GPX file needs at least two GPS points");
  }

  const name =
    childText(track ?? "", "name") ??
    childText(route ?? "", "name") ??
    childText(metadata ?? "", "name");
  const type =
    childText(track ?? "", "type") ??
    childText(route ?? "", "type") ??
    childText(metadata ?? "", "keywords");
  const startDate =
    points.find((point) => point.time)?.time ?? parseGpxTime(childText(metadata ?? "", "time"));

  return { name, type, startDate, points, segments: segments.length ? segments : undefined };
}

export function gpxToActivityFields(parsed: ParsedGpx, filename = "upload.gpx"): GpxActivityFields {
  const { points, breaks: routeBreaks } = stitchTrackSegments(parsed.segments ?? [parsed.points]);
  const latlng = points.map((point) => [point.lat, point.lng] as LatLng);
  const distance = trackDistanceWithBreaks(latlng, routeBreaks);
  const sport = mapSport(parsed.type);
  const altitude = points.every((point) => point.ele != null)
    ? points.map((point) => point.ele as number)
    : null;
  const timestamps = points.map((point) => point.time);
  const timed = timestamps.every((time) => time != null) ? (timestamps as Date[]) : null;
  const time = timed ? timed.map((value) => Math.round((value.getTime() - timed[0].getTime()) / 1000)) : null;
  const velocity = time ? speedsFromTrack(latlng, time, routeBreaks) : null;
  const elapsedTime = time && time.length ? time[time.length - 1] - time[0] : null;
  const movingTime = time && velocity ? movingSeconds(time, velocity) : elapsedTime;
  const maxSpeed = velocity?.reduce((max, speed) => Math.max(max, speed), 0) ?? null;
  const averageSpeed =
    movingTime && movingTime > 0 ? distance / movingTime : elapsedTime && elapsedTime > 0 ? distance / elapsedTime : null;
  const start =
    parsed.startDate && !Number.isNaN(parsed.startDate.getTime()) ? parsed.startDate : new Date();

  return {
    name: parsed.name?.trim() || nameFromFilename(filename),
    type: sport.type,
    sportType: sport.sport,
    startDate: start.toISOString(),
    distance,
    movingTime,
    elapsedTime,
    elevationGain: altitude ? elevationGainM(altitude) : null,
    averageSpeed,
    maxSpeed: maxSpeed && maxSpeed > 0 ? maxSpeed : null,
    latlng,
    routeBreaks,
    time,
    velocity,
    altitude,
    bbox: bboxFromLatLng(latlng),
  };
}

export function nameFromFilename(filename: string): string {
  const base = filename
    .replace(/^.*[/\\]/, "")
    .replace(/\.(gpx|fit|tcx)(\.gz)?$/i, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  return base || "Imported ride";
}

export function mapSport(raw: string | null | undefined): { type: string; sport: string } {
  if (!raw) return { type: "Ride", sport: "Ride" };
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  return SPORT_MAP[key] ?? titleSport(raw);
}

function titleSport(raw: string): { type: string; sport: string } {
  const sport = raw
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { type: sport || "Ride", sport: sport || "Ride" };
}

function parsePoints(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  POINT_RE.lastIndex = 0;
  for (const match of xml.matchAll(POINT_RE)) {
    const lat = Number(attr(match[2], "lat"));
    const lng = Number(attr(match[2], "lon") ?? attr(match[2], "lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const body = match[3] ?? "";
    const eleRaw = childText(body, "ele");
    const ele = eleRaw != null && eleRaw !== "" ? Number(eleRaw) : null;
    points.push({
      lat,
      lng,
      ele: ele != null && Number.isFinite(ele) ? ele : null,
      time: parseGpxTime(childText(body, "time")),
    });
  }
  return points;
}

function elevationGainM(eles: number[]): number {
  let gain = 0;
  for (let i = 1; i < eles.length; i += 1) {
    const delta = eles[i] - eles[i - 1];
    if (delta > ELE_NOISE_M) gain += delta;
  }
  return gain;
}

function speedsFromTrack(latlng: LatLng[], time: number[], breaks: number[] = []): number[] {
  const speeds = [0];
  const starts = new Set(breaks);
  for (let i = 1; i < latlng.length; i += 1) {
    const dt = time[i] - time[i - 1];
    speeds.push(dt > 0 && !starts.has(i) ? haversineM(latlng[i - 1], latlng[i]) / dt : 0);
  }
  return speeds;
}

function movingSeconds(time: number[], velocity: number[]): number {
  let moving = 0;
  for (let i = 1; i < time.length; i += 1) {
    const dt = time[i] - time[i - 1];
    if (dt > 0 && velocity[i] >= MOVING_SPEED_MS) moving += dt;
  }
  return moving;
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

function parseGpxTime(raw: string | null): Date | null {
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

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}
