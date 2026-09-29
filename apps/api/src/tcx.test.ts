import assert from "node:assert/strict";
import { test } from "node:test";
import { gpxToActivityFields } from "./gpx";
import { TcxError, parseTcx } from "./tcx";

const STRAVA_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2024-07-04T14:00:00Z</Id>
      <Notes>Morning Ride</Notes>
      <Lap StartTime="2024-07-04T14:00:00Z">
        <Track>
          <Trackpoint>
            <Time>2024-07-04T14:00:00Z</Time>
            <Position>
              <LatitudeDegrees>53.5400</LatitudeDegrees>
              <LongitudeDegrees>-113.5000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>670.0</AltitudeMeters>
          </Trackpoint>
          <Trackpoint>
            <Time>2024-07-04T14:00:20Z</Time>
            <Position>
              <LatitudeDegrees>53.5410</LatitudeDegrees>
              <LongitudeDegrees>-113.5000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>676.4</AltitudeMeters>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap StartTime="2024-07-04T14:00:20Z">
        <Track>
          <Trackpoint>
            <Time>2024-07-04T14:00:40Z</Time>
            <Position>
              <LatitudeDegrees>53.5420</LatitudeDegrees>
              <LongitudeDegrees>-113.5000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>674.0</AltitudeMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

test("parseTcx reads a Strava activity name, sport, and laps", () => {
  const parsed = parseTcx(STRAVA_TCX);
  assert.equal(parsed.name, "Morning Ride");
  assert.equal(parsed.type, "Biking");
  assert.equal(parsed.points.length, 3);
  assert.equal(parsed.points[0].lat, 53.54);
  assert.equal(parsed.points[0].lng, -113.5);
  assert.equal(parsed.points[0].ele, 670);
  assert.equal(parsed.startDate?.toISOString(), "2024-07-04T14:00:00.000Z");
});

test("parseTcx falls back to a named course", () => {
  const parsed = parseTcx(`<TrainingCenterDatabase>
    <Courses>
      <Course>
        <Name>Dirt shortcut</Name>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>40.1</LatitudeDegrees><LongitudeDegrees>-105.2</LongitudeDegrees></Position>
          </Trackpoint>
          <Trackpoint>
            <Position><LatitudeDegrees>40.2</LatitudeDegrees><LongitudeDegrees>-105.3</LongitudeDegrees></Position>
          </Trackpoint>
        </Track>
      </Course>
    </Courses>
  </TrainingCenterDatabase>`);
  assert.equal(parsed.name, "Dirt shortcut");
  assert.equal(parsed.points.length, 2);
});

test("parseTcx handles namespaced tags and skips points without GPS", () => {
  const parsed = parseTcx(`<ns:TrainingCenterDatabase xmlns:ns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <ns:Activities>
      <ns:Activity Sport="Running">
        <ns:Lap>
          <ns:Track>
            <ns:Trackpoint>
              <ns:Time>2024-01-01T00:00:00Z</ns:Time>
            </ns:Trackpoint>
            <ns:Trackpoint>
              <ns:Position>
                <ns:LatitudeDegrees>42.1</ns:LatitudeDegrees>
                <ns:LongitudeDegrees>-121.4</ns:LongitudeDegrees>
              </ns:Position>
              <ns:AltitudeMeters>1200</ns:AltitudeMeters>
            </ns:Trackpoint>
            <ns:Trackpoint>
              <ns:Position>
                <ns:LatitudeDegrees>42.2</ns:LatitudeDegrees>
                <ns:LongitudeDegrees>-121.5</ns:LongitudeDegrees>
              </ns:Position>
            </ns:Trackpoint>
          </ns:Track>
        </ns:Lap>
      </ns:Activity>
    </ns:Activities>
  </ns:TrainingCenterDatabase>`);
  assert.equal(parsed.type, "Running");
  assert.equal(parsed.points.length, 2);
  assert.equal(parsed.points[0].ele, 1200);
});

test("parseTcx rejects non-TCX and tracks with one point", () => {
  assert.throws(() => parseTcx("<gpx></gpx>"), TcxError);
  assert.throws(
    () =>
      parseTcx(`<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap><Track>
        <Trackpoint><Position><LatitudeDegrees>1</LatitudeDegrees><LongitudeDegrees>2</LongitudeDegrees></Position></Trackpoint>
      </Track></Lap></Activity></Activities></TrainingCenterDatabase>`),
    /at least two/,
  );
});

test("gpxToActivityFields maps TCX biking to Ride", () => {
  const fields = gpxToActivityFields(parseTcx(STRAVA_TCX), "ignored.tcx");
  assert.equal(fields.name, "Morning Ride");
  assert.equal(fields.type, "Ride");
  assert.equal(fields.sportType, "Ride");
  assert.ok(fields.distance > 200 && fields.distance < 250);
  assert.equal(fields.elapsedTime, 40);
  assert.ok(fields.elevationGain != null && fields.elevationGain > 6 && fields.elevationGain < 7);
});

test("TCX track boundaries preserve a real recording gap", () => {
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap>
    <Track><Trackpoint><Position><LatitudeDegrees>49</LatitudeDegrees><LongitudeDegrees>-124</LongitudeDegrees></Position></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>49.001</LatitudeDegrees><LongitudeDegrees>-124</LongitudeDegrees></Position></Trackpoint></Track>
    <Track><Trackpoint><Position><LatitudeDegrees>50</LatitudeDegrees><LongitudeDegrees>-124</LongitudeDegrees></Position></Trackpoint>
    <Trackpoint><Position><LatitudeDegrees>50.001</LatitudeDegrees><LongitudeDegrees>-124</LongitudeDegrees></Position></Trackpoint></Track>
  </Lap></Activity></Activities></TrainingCenterDatabase>`;
  const parsed = parseTcx(xml);
  assert.equal(parsed.segments?.length, 2);
  const fields = gpxToActivityFields(parsed, "gap.tcx");
  assert.deepEqual(fields.routeBreaks, [2]);
  assert.ok(fields.distance > 200 && fields.distance < 230);
});
