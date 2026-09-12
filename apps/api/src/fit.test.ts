import assert from "node:assert/strict";
import { test } from "node:test";
import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import { FitError, fitSportName, isFitBytes, parseFit } from "./fit";
import { gpxToActivityFields } from "./gpx";

const SEMI = 2_147_483_648 / 180;

function toSemi(deg: number) {
  return Math.round(deg * SEMI);
}

function encodeRideFit(overrides?: { sport?: string; subSport?: string; skipPoints?: boolean }) {
  const encoder = new Encoder();
  const start = new Date("2024-07-04T14:00:00Z");
  const t0 = Utils.convertDateToDateTime(start);
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "development",
    product: 0,
    timeCreated: t0,
  });
  if (!overrides?.skipPoints) {
    for (const point of [
      { lat: 53.54, lng: -113.5, ele: 670, t: 0 },
      { lat: 53.541, lng: -113.5, ele: 676.4, t: 20 },
      { lat: 53.542, lng: -113.5, ele: 674, t: 40 },
    ]) {
      encoder.writeMesg({
        mesgNum: Profile.MesgNum.RECORD,
        timestamp: t0 + point.t,
        positionLat: toSemi(point.lat),
        positionLong: toSemi(point.lng),
        enhancedAltitude: point.ele,
      });
    }
  }
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: t0 + 40,
    startTime: t0,
    sport: overrides?.sport ?? "cycling",
    subSport: overrides?.subSport ?? "generic",
    totalElapsedTime: 40,
    totalTimerTime: 40,
  });
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.ACTIVITY,
    timestamp: t0 + 40,
    numSessions: 1,
    totalTimerTime: 40,
  });
  return encoder.close();
}

test("isFitBytes detects the FIT header magic", () => {
  const bytes = encodeRideFit();
  assert.equal(isFitBytes(bytes), true);
  assert.equal(isFitBytes(new TextEncoder().encode("<gpx></gpx>")), false);
});

test("parseFit reads GPS points, sport, and timestamps", () => {
  const parsed = parseFit(encodeRideFit());
  assert.equal(parsed.type, "cycling");
  assert.equal(parsed.points.length, 3);
  assert.ok(Math.abs(parsed.points[0].lat - 53.54) < 0.0001);
  assert.ok(Math.abs(parsed.points[0].lng + 113.5) < 0.0001);
  assert.equal(parsed.points[0].ele, 670);
  assert.equal(parsed.startDate?.toISOString(), "2024-07-04T14:00:00.000Z");
});

test("parseFit plus gpxToActivityFields matches a Strava-style ride", () => {
  const fields = gpxToActivityFields(parseFit(encodeRideFit()), "morning_ride.fit");
  assert.equal(fields.name, "morning ride");
  assert.equal(fields.sportType, "Ride");
  assert.ok(fields.distance > 200 && fields.distance < 250);
  assert.equal(fields.elapsedTime, 40);
  assert.ok(fields.elevationGain != null && fields.elevationGain > 6 && fields.elevationGain < 7);
});

test("parseFit maps mountain-bike and trail-run subsports", () => {
  assert.equal(parseFit(encodeRideFit({ sport: "cycling", subSport: "mountain" })).type, "mountainbikeride");
  assert.equal(parseFit(encodeRideFit({ sport: "running", subSport: "trail" })).type, "trailrun");
  assert.deepEqual(fitSportName("cycling", "gravelCycling"), "gravelride");
});

test("parseFit rejects non-FIT and tracks without GPS", () => {
  assert.throws(() => parseFit(new TextEncoder().encode("<gpx></gpx>")), FitError);
  assert.throws(() => parseFit(encodeRideFit({ skipPoints: true })), /at least two GPS points/);
});
