import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync, zipSync } from "fflate";
import { expandImportArchive, isZipBytes, maybeGunzip, parseActivitiesCsv } from "./archive";
import { overlayArchiveMeta } from "./importActivity";
import { gpxToActivityFields, parseGpx } from "./gpx";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Track name</name>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="53.5400" lon="-113.5000"><ele>670.0</ele><time>2024-07-04T14:00:00Z</time></trkpt>
      <trkpt lat="53.5410" lon="-113.5000"><ele>676.4</ele><time>2024-07-04T14:00:20Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const CSV = `Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Filename,Athlete Weight
12927088301,"Jul 4, 2024, 2:00:00 PM",CSV Morning Ride,Ride,3600,25000,activities/12927088301.gpx.gz,70
12927088302,"Jul 5, 2024, 8:00:00 AM",Trainer grind,VirtualRide,1800,0,,70
12927088303,"Jul 6, 2024, 9:00:00 AM",Missing file,Hike,1200,1000,activities/nope.gpx,70
`;

function zipBytes(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    encoded[name] = typeof value === "string" ? new TextEncoder().encode(value) : value;
  }
  return zipSync(encoded);
}

test("isZipBytes detects a zip and rejects GPX", () => {
  const zip = zipBytes({ "readme.txt": "hi" });
  assert.equal(isZipBytes(zip), true);
  assert.equal(isZipBytes(new TextEncoder().encode(GPX)), false);
});

test("parseActivitiesCsv reads account-export columns and quoted dates", () => {
  const rows = parseActivitiesCsv(CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 12927088301);
  assert.equal(rows[0].name, "CSV Morning Ride");
  assert.equal(rows[0].type, "Ride");
  assert.equal(rows[0].filename, "activities/12927088301.gpx.gz");
  assert.equal(rows[0].distance, 25000);
  assert.ok(rows[0].startDate);
  assert.equal(rows[1].filename, null);
});

test("expandImportArchive uses activities.csv names and skips empty or missing files", () => {
  const tracks = expandImportArchive(
    zipBytes({
      "export_129270883/activities.csv": CSV,
      "export_129270883/activities/12927088301.gpx.gz": gzipSync(new TextEncoder().encode(GPX)),
      "export_129270883/media/photo.jpg": new Uint8Array([1, 2, 3]),
    }),
    "export_129270883.zip",
  );
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].origin, "archive");
  assert.equal(tracks[0].externalId, 12927088301);
  assert.equal(tracks[0].name, "CSV Morning Ride");
  assert.equal(tracks[0].type, "Ride");
  assert.equal(new TextDecoder().decode(tracks[0].bytes).includes("<gpx"), true);
});

test("expandImportArchive imports loose track files when there is no CSV", () => {
  const tracks = expandImportArchive(
    zipBytes({
      "rides/loop.gpx": GPX,
      "rides/12999.fit.gz": gzipSync(new TextEncoder().encode(GPX)),
    }),
  );
  assert.equal(tracks.length, 2);
  const numbered = tracks.find((track) => track.filename.startsWith("12999"));
  assert.equal(numbered?.externalId, 12999);
  assert.equal(tracks.find((track) => track.filename === "loop.gpx")?.externalId, null);
});

test("maybeGunzip unwraps gzipped tracks", () => {
  const encoded = new TextEncoder().encode(GPX);
  const raw = maybeGunzip(gzipSync(encoded), "129.gpx.gz");
  assert.equal(new TextDecoder().decode(raw).includes("<trkpt"), true);
  assert.deepEqual(maybeGunzip(encoded, "ride.gpx"), encoded);
});

test("overlayArchiveMeta prefers archive CSV metadata", () => {
  const fields = overlayArchiveMeta(gpxToActivityFields(parseGpx(GPX), "12927088301.gpx.gz"), {
    name: "CSV Morning Ride",
    type: "Trail Run",
    startDate: "2024-07-04T20:00:00.000Z",
    distance: 25_000,
    movingTime: 3_000,
    elapsedTime: 3_600,
    elevationGain: 420,
    averageSpeed: 8.3,
    maxSpeed: 17.5,
  });
  assert.equal(fields.name, "CSV Morning Ride");
  assert.equal(fields.sportType, "TrailRun");
  assert.equal(fields.startDate, "2024-07-04T20:00:00.000Z");
  assert.equal(fields.distance, 25_000);
  assert.equal(fields.movingTime, 3_000);
  assert.equal(fields.elevationGain, 420);
});

test("expandImportArchive rejects an empty or trackless zip", () => {
  assert.throws(() => expandImportArchive(zipBytes({ "profile.csv": "a,b\n1,2" }), "export.zip"), /no GPX/);
});
