import assert from "node:assert/strict";
import { test } from "node:test";
import { formatImportNotice } from "./importNotice";

test("a single successful import stays quiet", () => {
  assert.equal(formatImportNotice({ imported: 1, skipped: 0, errors: [] }), null);
  assert.equal(formatImportNotice({ imported: 0, skipped: 0, errors: [] }), null);
});

test("several successful imports summarize the count", () => {
  assert.deepEqual(formatImportNotice({ imported: 3, skipped: 0, errors: [] }), {
    tone: "ok",
    summary: "Imported 3 activities.",
    failures: [],
  });
});

test("mixed results name the files that failed", () => {
  const notice = formatImportNotice({
    imported: 2,
    skipped: 1,
    errors: [{ filename: "notes.txt", error: "Upload a GPX, FIT, TCX, or a Strava export zip" }],
  });
  assert.equal(notice?.tone, "mixed");
  assert.equal(
    notice?.summary,
    "Imported 2 activities. 1 file was already in your library. 1 file could not be imported.",
  );
  assert.deepEqual(notice?.failures, [
    { filename: "notes.txt", error: "Upload a GPX, FIT, TCX, or a Strava export zip" },
  ]);
});

test("a failed batch lists every file", () => {
  const notice = formatImportNotice({
    imported: 0,
    skipped: 0,
    errors: [
      { filename: "a.txt", error: "not a track" },
      { filename: "b.txt", error: "not a track" },
    ],
  });
  assert.equal(notice?.tone, "error");
  assert.equal(notice?.summary, "2 files could not be imported.");
  assert.equal(notice?.failures.length, 2);
});

test("one success beside one failure is a mixed result", () => {
  const notice = formatImportNotice({
    imported: 1,
    skipped: 0,
    errors: [{ filename: "broken.gpx", error: "GPX file needs at least two GPS points" }],
  });
  assert.equal(notice?.tone, "mixed");
  assert.equal(notice?.summary, "Imported 1 activity. 1 file could not be imported.");
});
