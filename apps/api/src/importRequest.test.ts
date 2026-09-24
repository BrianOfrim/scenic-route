import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_IMPORT_FILES, MAX_TRACK_BYTES, filesFromRequest } from "./importRequest";

function gpx(name: string, lat = 53.54, lon = -113.5) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"><trk><name>${name}</name><trkseg>
<trkpt lat="${lat}" lon="${lon}"></trkpt>
<trkpt lat="${lat + 0.01}" lon="${lon}"></trkpt>
</trkseg></trk></gpx>`;
}

test("filesFromRequest reads every file from one multipart upload", async () => {
  const form = new FormData();
  form.append("file", new File([gpx("River")], "river.gpx", { type: "application/gpx+xml" }));
  form.append("file", new File([gpx("Sea")], "seawall.tcx", { type: "application/vnd.garmin.tcx+xml" }));
  form.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
  const parsed = await filesFromRequest(
    new Request("http://localhost/api/activities/import", { method: "POST", body: form }),
  );
  assert.deepEqual(
    parsed.files.map((file) => file.filename),
    ["river.gpx", "seawall.tcx", "notes.txt"],
  );
  assert.deepEqual(parsed.errors, []);
  assert.match(new TextDecoder().decode(parsed.files[0].bytes), /River/);
});

test("filesFromRequest still accepts a single file", async () => {
  const form = new FormData();
  form.append("file", new File([gpx("Solo")], "solo.gpx"));
  const parsed = await filesFromRequest(
    new Request("http://localhost/api/activities/import", { method: "POST", body: form }),
  );
  assert.deepEqual(
    parsed.files.map((file) => file.filename),
    ["solo.gpx"],
  );
  assert.deepEqual(parsed.errors, []);
});

test("filesFromRequest keeps the valid files when one file is too large", async () => {
  const form = new FormData();
  form.append("file", new File([gpx("Ok")], "ok.gpx"));
  form.append("file", new File([new Uint8Array(MAX_TRACK_BYTES + 1)], "huge.gpx"));
  const parsed = await filesFromRequest(
    new Request("http://localhost/api/activities/import", { method: "POST", body: form }),
  );
  assert.deepEqual(
    parsed.files.map((file) => file.filename),
    ["ok.gpx"],
  );
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].filename, "huge.gpx");
  assert.match(parsed.errors[0].error, /too large/);
});

test("filesFromRequest reports files beyond the batch limit", async () => {
  const form = new FormData();
  for (let i = 0; i < MAX_IMPORT_FILES + 1; i += 1) {
    form.append("file", new File([gpx(`Ride ${i}`)], `ride-${i}.gpx`));
  }
  const parsed = await filesFromRequest(
    new Request("http://localhost/api/activities/import", { method: "POST", body: form }),
  );
  assert.equal(parsed.files.length, MAX_IMPORT_FILES);
  assert.equal(parsed.files[0].filename, "ride-0.gpx");
  assert.deepEqual(parsed.errors, [
    { filename: `ride-${MAX_IMPORT_FILES}.gpx`, error: `Only ${MAX_IMPORT_FILES} files can be imported at once` },
  ]);
});

test("filesFromRequest reads a JSON array of tracks and a single JSON object", async () => {
  const many = await filesFromRequest(
    new Request("http://localhost/api/activities/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { filename: "a.gpx", gpx: gpx("A") },
        { filename: "b.gpx", gpx: gpx("B", 49.28, -123.12) },
      ]),
    }),
  );
  assert.deepEqual(
    many.files.map((file) => file.filename),
    ["a.gpx", "b.gpx"],
  );
  const one = await filesFromRequest(
    new Request("http://localhost/api/activities/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "only.gpx", gpx: gpx("Only") }),
    }),
  );
  assert.deepEqual(
    one.files.map((file) => file.filename),
    ["only.gpx"],
  );
});
