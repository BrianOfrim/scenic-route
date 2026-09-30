import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { GpxError, gpxToActivityFields, mapSport, nameFromFilename, parseGpx } from "./gpx";

const STRAVA_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <time>2024-07-04T14:00:00Z</time>
  </metadata>
  <trk>
    <name>Morning Ride</name>
    <type>cycling</type>
    <trkseg>
      <trkpt lat="53.5400" lon="-113.5000">
        <ele>670.0</ele>
        <time>2024-07-04T14:00:00Z</time>
      </trkpt>
      <trkpt lat="53.5410" lon="-113.5000">
        <ele>676.4</ele>
        <time>2024-07-04T14:00:20Z</time>
      </trkpt>
      <trkpt lat="53.5420" lon="-113.5000">
        <ele>674.0</ele>
        <time>2024-07-04T14:00:40Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

test("parseGpx reads a Strava track name, type, and points", () => {
  const parsed = parseGpx(STRAVA_GPX);
  assert.equal(parsed.name, "Morning Ride");
  assert.equal(parsed.type, "cycling");
  assert.equal(parsed.points.length, 3);
  assert.equal(parsed.points[0].lat, 53.54);
  assert.equal(parsed.points[0].lng, -113.5);
  assert.equal(parsed.points[0].ele, 670);
  assert.equal(parsed.startDate?.toISOString(), "2024-07-04T14:00:00.000Z");
});

test("parseGpx joins multiple track segments and falls back to routes", () => {
  const multi = parseGpx(`<gpx>
    <trk>
      <trkseg>
        <trkpt lat="1" lon="2"><ele>10</ele></trkpt>
        <trkpt lat="1.001" lon="2" />
      </trkseg>
      <trkseg>
        <trkpt lat="1.002" lon="2"></trkpt>
      </trkseg>
    </trk>
  </gpx>`);
  assert.equal(multi.points.length, 3);
  assert.equal(multi.segments?.length, 2);

  const route = parseGpx(`<gpx>
    <rte>
      <name>Dirt shortcut</name>
      <rtept lat="40.1" lon="-105.2"></rtept>
      <rtept lat="40.2" lon="-105.3"></rtept>
    </rte>
  </gpx>`);
  assert.equal(route.name, "Dirt shortcut");
  assert.equal(route.points.length, 2);
});

test("West Coast Trail segments stitch without the five long jumps", () => {
  const xml = fs.readFileSync(new URL("../../../examples/canadian-routes/west-coast-trail.gpx", import.meta.url), "utf8");
  const parsed = parseGpx(xml);
  assert.equal(parsed.segments?.length, 7);
  const fields = gpxToActivityFields(parsed, "west-coast-trail.gpx");
  assert.deepEqual(fields.routeBreaks, []);
  assert.ok(fields.distance > 75_000 && fields.distance < 77_000);
});

test("parseGpx handles namespaced tags and CDATA names", () => {
  const parsed = parseGpx(`<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1">
    <gpx:trk>
      <gpx:name><![CDATA[PCT Day 12]]></gpx:name>
      <gpx:trkpt lat="42.1" lon="-121.4">
        <gpx:ele>1200</gpx:ele>
      </gpx:trkpt>
      <gpx:trkpt lat="42.2" lon="-121.5">
        <gpx:ele>1210</gpx:ele>
      </gpx:trkpt>
    </gpx:trk>
  </gpx:gpx>`);
  assert.equal(parsed.name, "PCT Day 12");
  assert.equal(parsed.points.length, 2);
  assert.equal(parsed.points[0].ele, 1200);
});

test("parseGpx rejects non-GPX and tracks with one point", () => {
  assert.throws(() => parseGpx("<html></html>"), GpxError);
  assert.throws(() => parseGpx("<gpx><trk><trkpt lat='1' lon='2'/></trk></gpx>"), /at least two/);
});

test("gpxToActivityFields computes distance, time, and elevation", () => {
  const fields = gpxToActivityFields(parseGpx(STRAVA_GPX), "ignored.gpx");
  assert.equal(fields.name, "Morning Ride");
  assert.equal(fields.type, "Ride");
  assert.equal(fields.sportType, "Ride");
  assert.equal(fields.startDate, "2024-07-04T14:00:00.000Z");
  assert.ok(fields.distance > 200 && fields.distance < 250);
  assert.equal(fields.elapsedTime, 40);
  assert.equal(fields.time?.[2], 40);
  assert.ok(fields.elevationGain != null && fields.elevationGain > 6 && fields.elevationGain < 7);
  assert.deepEqual(fields.bbox[0] < fields.bbox[2] || fields.bbox[1] <= fields.bbox[3], true);
});

test("gpxToActivityFields falls back to the filename and Ride", () => {
  const fields = gpxToActivityFields(
    parseGpx(`<gpx><trk><trkpt lat="1" lon="2"/><trkpt lat="1.01" lon="2"/></trk></gpx>`),
    "sunset_loop.gpx",
  );
  assert.equal(fields.name, "sunset loop");
  assert.equal(fields.sportType, "Ride");
  assert.equal(fields.time, null);
  assert.equal(fields.altitude, null);
});

test("mapSport and nameFromFilename cover common exports", () => {
  assert.deepEqual(mapSport("trail_run"), { type: "Run", sport: "TrailRun" });
  assert.deepEqual(mapSport("Mountain Bike"), { type: "Ride", sport: "MountainBikeRide" });
  assert.deepEqual(mapSport("Stand Up Paddle"), { type: "Stand Up Paddle", sport: "Stand Up Paddle" });
  assert.equal(nameFromFilename("/tmp/First-Snow_Hike.gpx"), "First-Snow Hike");
  assert.equal(nameFromFilename("12927088301.gpx.gz"), "12927088301");
  assert.equal(nameFromFilename(".gpx"), "Imported ride");
});
