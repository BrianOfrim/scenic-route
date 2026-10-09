import assert from "node:assert/strict";
import { zipSync, gzipSync } from "fflate";
import { after, before, describe, test } from "node:test";
import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import type { ActivityMesg, Encodable, FileIdMesg, RecordMesg, SessionMesg } from "@garmin/fitsdk";
import { deleteImportedByIds } from "./activities";
import { closeDb, initDb, query } from "./db";
import { clearImportedIdFloor } from "./importedIds";
import { importTrackFiles } from "./importActivity";
import { posterStore } from "./storage";

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
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "development",
    product: 0,
    timeCreated: t0,
  };
  encoder.writeMesg(fileId);
  for (const [index, point] of [
    { lat, lng: lon, t: 0 },
    { lat: lat + 0.01, lng: lon, t: 20 },
    { lat: lat + 0.02, lng: lon, t: 40 },
  ].entries()) {
    const record: Encodable<RecordMesg> = {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: t0 + point.t,
      positionLat: Math.round(point.lat * SEMI),
      positionLong: Math.round(point.lng * SEMI),
      enhancedAltitude: 600 + index,
    };
    encoder.writeMesg(record);
  }
  const session: Encodable<SessionMesg> = {
    mesgNum: Profile.MesgNum.SESSION,
    timestamp: t0 + 40,
    startTime: t0,
    sport: "cycling",
    subSport: "generic",
    totalElapsedTime: 40,
    totalTimerTime: 40,
  };
  encoder.writeMesg(session);
  const activity: Encodable<ActivityMesg> = {
    mesgNum: Profile.MesgNum.ACTIVITY,
    timestamp: t0 + 40,
    numSessions: 1,
    totalTimerTime: 40,
  };
  encoder.writeMesg(activity);
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
    await clearImportedIdFloor(userId);
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

  test("persists compressed Strava exports with CSV metadata and loose gzip tracks", async () => {
    await withUser("compressed", async userId => {
      const exported = new TextEncoder().encode(gpx("Original", 45, -110));
      const result = await importTrackFiles(userId, [
        { filename: "export.zip", bytes: zipSync({
          "export/activities.csv": new TextEncoder().encode("Activity ID,Activity Name,Activity Type,Filename\n123456789,CSV Ride,Ride,activities/123456789.gpx.gz\n"),
          "export/activities/123456789.gpx.gz": gzipSync(exported),
        }) },
        { filename: "loose.tcx.gz", bytes: gzipSync(new TextEncoder().encode(tcx("Compressed TCX", 46, -111))) },
        { filename: "loose.fit.gz", bytes: gzipSync(fit(47, -112)) },
      ]);
      assert.deepEqual(result.errors, []);
      assert.equal(result.activities.length, 3);
      assert.equal(result.activities.find(activity => activity.id === 123456789)?.name, "CSV Ride");
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

  test("re-importing a legacy track repairs its route while keeping the activity id", async () => {
    await withUser("repair", async (userId) => {
      const file = textFile("broken.gpx", `<gpx><trk><name>Broken</name>
        <trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg>
        <trkseg><trkpt lat="0" lon="0.101"/><trkpt lat="0" lon="0.1"/></trkseg>
      </trk></gpx>`);
      const first = await importTrackFiles(userId, [file]);
      const id = first.activities[0].id;
      await query("UPDATE activities SET route_breaks = NULL, distance = 999999 WHERE user_id = $1 AND id = $2", [userId, id]);
      const repaired = await importTrackFiles(userId, [file]);
      assert.equal(repaired.activities[0].id, id);
      assert.ok(repaired.activities[0].distance < 300);
      const rows = await query<{ route_breaks: string }>("SELECT route_breaks FROM activities WHERE user_id = $1 AND id = $2", [userId, id]);
      assert.deepEqual(JSON.parse(rows[0].route_breaks), [2]);
      assert.equal((await importTrackFiles(userId, [file])).skipped, 1);
    });
  });

  test("re-importing a deleted file gets a new id when the gallery has no posters for it", async () => {
    await withUser("same-bytes-empty", async (userId) => {
      const file = textFile("beltline.gpx", gpx("Beltline Trail", 53.54, -113.5));
      const first = await importTrackFiles(userId, [file]);
      const id = first.activities[0]?.id;
      assert.ok(id);
      await deleteImportedByIds(userId, [id]);
      const second = await importTrackFiles(userId, [file]);
      const secondId = second.activities[0]?.id;
      assert.ok(secondId);
      assert.ok(secondId > id);
      assert.equal(second.skipped, 0);
    });
  });

  test("re-importing a deleted file keeps its id when gallery posters still use it", async () => {
    await withUser("same-bytes-posters", async (userId) => {
      const file = textFile("beltline.gpx", gpx("Beltline Trail", 53.54, -113.5));
      const first = await importTrackFiles(userId, [file]);
      const id = first.activities[0]?.id;
      assert.ok(id);
      const posterId = "20260101T000000Z-abc123";
      await posterStore().put(
        userId,
        `${posterId}.json`,
        Buffer.from(JSON.stringify({
          posterId,
          userId,
          activityId: id,
          title: "Beltline Trail",
          subtitle: "10.5 km",
          model: "test",
          aspectRatio: "2:3",
          cost: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          styleId: "topo",
          referenceCount: 0,
          url: `/api/posters/${posterId}.png`,
        })),
        "application/json",
      );
      try {
        await deleteImportedByIds(userId, [id]);
        const second = await importTrackFiles(userId, [file]);
        assert.equal(second.activities[0]?.id, id);
        assert.equal(second.skipped, 0);
      } finally {
        await posterStore().removeByPosterId(userId, posterId);
      }
    });
  });

  test("a deleted import does not give its id to the next file", async () => {
    await withUser("reuse", async (userId) => {
      const first = await importTrackFiles(userId, [textFile("first.gpx", gpx("First Loop", 53.54, -113.5))]);
      const firstId = first.activities[0]?.id;
      assert.ok(firstId);
      await deleteImportedByIds(userId, [firstId]);
      const second = await importTrackFiles(userId, [textFile("second.gpx", gpx("Second Loop", 49.28, -123.12))]);
      const secondId = second.activities[0]?.id;
      assert.ok(secondId);
      assert.ok(secondId > firstId);
    });
  });
});
