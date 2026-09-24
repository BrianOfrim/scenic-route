import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import { closeDb, initDb, query } from "./db";
import { importTrackFiles } from "./importActivity";

const SEMI = 2_147_483_648 / 180;

function gpx(name: string, lat: number, lon: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="ScenicRoute" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="${lat.toFixed(4)}" lon="${lon.toFixed(4)}"><ele>100</ele><time>2024-07-04T14:00:00Z</time></trkpt>
      <trkpt lat="${(lat + 0.01).toFixed(4)}" lon="${lon.toFixed(4)}"><ele>110</ele><time>2024-07-04T14:05:00Z</time></trkpt>
      <trkpt lat="${(lat + 0.02).toFixed(4)}" lon="${lon.toFixed(4)}"><ele>105</ele><time>2024-07-04T14:10:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;
}

function tcx(name: string, lat: number, lon: number) {
  const point = (index: number) => `<Trackpoint>
    <Time>2024-07-04T14:0${index}:00Z</Time>
    <Position><LatitudeDegrees>${(lat + index * 0.01).toFixed(4)}</LatitudeDegrees><LongitudeDegrees>${lon.toFixed(4)}</LongitudeDegrees></Position>
    <AltitudeMeters>20</AltitudeMeters>
  </Trackpoint>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Biking"><Id>2024-07-04T14:00:00Z</Id><Notes>${name}</Notes>
    <Lap StartTime="2024-07-04T14:00:00Z"><Track>${point(0)}${point(1)}${point(2)}</Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;
}

function fit(lat: number, lon: number) {
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
  for (const [index, point] of [
    { lat, lng: lon, t: 0 },
    { lat: lat + 0.01, lng: lon, t: 20 },
    { lat: lat + 0.02, lng: lon, t: 40 },
  ].entries()) {
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: t0 + point.t,
      positionLat: Math.round(point.lat * SEMI),
      positionLong: Math.round(point.lng * SEMI),
      enhancedAltitude: 600 + index,
    });
  }
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: t0 + 40,
    startTime: t0,
    sport: "cycling",
    subSport: "generic",
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

function textFile(filename: string, contents: string) {
  return { filename, bytes: new TextEncoder().encode(contents) };
}

async function withUser(label: string, run: (userId: string) => Promise<void>) {
  const userId = `import-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, 'Import', $2, true)`,
    [userId, `${userId}@example.com`],
  );
  try {
    await run(userId);
  } finally {
    await query("DELETE FROM activities WHERE user_id = $1", [userId]);
    await query(`DELETE FROM "user" WHERE id = $1`, [userId]);
  }
}

describe("importTrackFiles", { concurrency: 1 }, () => {
  before(async () => {
    await initDb();
  });

  after(async () => {
    await closeDb();
  });

  test("imports several GPX, FIT, and TCX files and reports the ones that fail", async () => {
    await withUser("batch", async (userId) => {
      const result = await importTrackFiles(userId, [
        textFile("river.gpx", gpx("River Loop", 53.54, -113.5)),
        textFile("seawall.tcx", tcx("Seawall", 49.28, -123.12)),
        { filename: "ridge.fit", bytes: fit(51.044, -114.07) },
        textFile("notes.txt", "not a gps file"),
        { filename: "broken.zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]) },
      ]);

      assert.deepEqual(
        result.activities.map((item) => item.name).sort(),
        ["River Loop", "Seawall", "ridge"],
      );
      assert.equal(result.skipped, 0);
      assert.deepEqual(
        result.errors.map((item) => item.filename).sort(),
        ["broken.zip", "notes.txt"],
      );
      assert.match(result.errors.find((item) => item.filename === "notes.txt")?.error ?? "", /GPX, FIT, TCX/);
      assert.match(result.errors.find((item) => item.filename === "broken.zip")?.error ?? "", /zip/i);

      const rows = await query<{ name: string; latlng: string; source: string }>(
        "SELECT name, latlng, source FROM activities WHERE user_id = $1",
        [userId],
      );
      const stored = new Map(rows.map((row) => [row.name, row]));
      const river = JSON.parse(stored.get("River Loop")?.latlng ?? "[]") as number[][];
      const sea = JSON.parse(stored.get("Seawall")?.latlng ?? "[]") as number[][];
      const ridge = JSON.parse(stored.get("ridge")?.latlng ?? "[]") as number[][];
      assert.equal(stored.get("River Loop")?.source, "gpx");
      assert.equal(stored.get("Seawall")?.source, "tcx");
      assert.equal(stored.get("ridge")?.source, "fit");
      assert.deepEqual(river[0], [53.54, -113.5]);
      assert.equal(river.length, 3);
      assert.deepEqual(sea[0], [49.28, -123.12]);
      assert.equal(sea.length, 3);
      assert.equal(ridge.length, 3);
      assert.ok(Math.abs(ridge[0][0] - 51.044) < 0.0001);
      assert.ok(Math.abs(ridge[0][1] + 114.07) < 0.0001);
    });
  });

  test("still imports a single GPX file", async () => {
    await withUser("single", async (userId) => {
      const result = await importTrackFiles(userId, [
        textFile("solo.gpx", gpx("Solo Spin", 45.42, -75.7)),
      ]);
      assert.equal(result.errors.length, 0);
      assert.equal(result.skipped, 0);
      assert.equal(result.activities.length, 1);
      assert.equal(result.activities[0].name, "Solo Spin");
      assert.equal(result.activities[0].format, "gpx");
      const row = await query<{ latlng: string }>(
        "SELECT latlng FROM activities WHERE user_id = $1 AND id = $2",
        [userId, result.activities[0].id],
      );
      const points = JSON.parse(row[0].latlng) as number[][];
      assert.deepEqual(points[0], [45.42, -75.7]);
      assert.equal(points.length, 3);
    });
  });
});
