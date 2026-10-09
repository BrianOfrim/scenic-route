import { Hono } from "hono";
import { createImportHandler, type ImportEnv } from "./importEndpoint";
import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, gzipSync, Zip, ZipDeflate } from "fflate";
import { Encoder, Profile } from "@garmin/fitsdk";
import { expandImportArchive, maybeGunzip, parseActivitiesCsv } from "./archive";
import { readBoundedZip } from "./boundedZip";
import { boundedImportRequest, filesFromJsonBody, ImportBodyLimitError, type ParsedUploads } from "./importRequest";
import { createImportGuard, ImportGuardError } from "./importGuard";
import { MAX_EXPANDED_BYTES, MAX_EXPANDED_TRACKS } from "./importLimits";
import { MAX_XML_POINTS } from "./importXml";
import { parseGpx, GpxError } from "./gpx";
import { parseTcx, TcxError } from "./tcx";
import { parseFit, FitError } from "./fit";
import { importTrackFiles } from "./importActivity";

const encode = (text: string) => new TextEncoder().encode(text);
const GPX = '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.01" lon="2"/></trkseg></trk></gpx>';
function zip(files: Record<string, string | Uint8Array>, level: 0 | 6 = 6) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, typeof bytes === "string" ? encode(bytes) : bytes])), { level });
}
const smallLimits = { entries: 10, file: 1024, total: 2048 };
function central(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 6, true);
}

test("ZIP enforces actual inflate output even with forged small size metadata", () => {
  const bytes = zip({ "bomb.gpx": new Uint8Array(8192) });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(central(bytes) + 24, 1, true);
  view.setUint32(22, 1, true);
  assert.throws(() => readBoundedZip(bytes, smallLimits), /expands beyond/);
});

test("ZIP rejects declared per-file/aggregate sizes and entry counts before expansion", () => {
  assert.throws(() => readBoundedZip(zip({ "a.gpx": new Uint8Array(1025) }), smallLimits), /too large/);
  assert.throws(() => readBoundedZip(zip({ "a.gpx": new Uint8Array(800), "b.tcx": new Uint8Array(800), "c.fit": new Uint8Array(800) }), smallLimits), /expands beyond/);
  assert.throws(() => readBoundedZip(zip({ "a.gpx": GPX, "ignored.txt": "x" }), { ...smallLimits, entries: 1 }), /too many files/);
});

test("ZIP stored entries, compressed entries and skipped media remain supported", () => {
  for (const level of [0, 6] as const) {
    const files = readBoundedZip(zip({ "a.gpx": GPX, "photo.jpg": new Uint8Array(8192) }, level), smallLimits);
    assert.equal(files.size, 1);
    assert.equal(new TextDecoder().decode(files.get("a.gpx")), GPX);
  }
});

test("ZIP rejects bad CRC, truncated data and central/local path disagreement", () => {
  const corrupt = zip({ "a.gpx": GPX });
  corrupt[central(corrupt) + 16] ^= 1;
  assert.throws(() => readBoundedZip(corrupt), /Could not read/);
  const mismatch = zip({ "a.gpx": GPX });
  mismatch[30] = 98;
  assert.throws(() => readBoundedZip(mismatch), /Could not read/);
  assert.throws(() => readBoundedZip(zip({ "a.gpx": GPX }).slice(0, -5)), /Could not read/);
});

test("ZIP rejects traversal, absolute, drive, NUL and backslash paths including ignored entries", () => {
  for (const path of ["../a.gpx", "rides/../../a.gpx", "/a.gpx", "C:/a.gpx", "././C:/a.gpx", "..\\a.gpx", "rides\\..\\a.gpx", "a\0.gpx", "../photo.jpg"]) {
    assert.throws(() => expandImportArchive(zip({ [path]: GPX })), /unsafe file path/, path);
  }
  assert.equal(expandImportArchive(zip({ "rides\\a.gpx": GPX }))[0].filename, "a.gpx");
});

test("CSV file references cannot traverse or use absolute paths and duplicate ZIP paths fail", () => {
  for (const path of ["../a.gpx", "/a.gpx", "C:/a.gpx", "././C:/a.gpx", "..\\a.gpx"]) {
    assert.throws(() => expandImportArchive(zip({ "activities.csv": `Activity ID,Filename\n1,${path}\n`, "a.gpx": GPX })), /unsafe file path/);
  }
  assert.throws(() => expandImportArchive(zip({ "a.gpx": GPX, "./a.gpx": GPX })), /duplicate/);
});

test("gzip bounds actual output and concatenated members regardless of trailer size", () => {
  const bomb = gzipSync(new Uint8Array(8192));
  assert.throws(() => maybeGunzip(bomb, "a.gpx.gz", 1024), /expands beyond/);
  new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength).setUint32(bomb.length - 4, 1, true);
  assert.throws(() => maybeGunzip(bomb, "a.gpx.gz", 1024), /expands beyond|not valid gzip/);
  const member = gzipSync(new Uint8Array(800));
  assert.throws(() => maybeGunzip(Buffer.concat([member, member]), "a.gpx.gz", 1024), /expands beyond/);
  assert.throws(() => maybeGunzip(member.slice(0, -3), "a.gpx.gz", 1024), /not valid gzip/);
});

test("nested gzip ZIPs share a request byte and track budget", () => {
  const gz = gzipSync(encode(GPX));
  const bytes = zip({ "a.gpx.gz": gz });
  assert.throws(() => expandImportArchive(bytes, "export.zip", { bytes: MAX_EXPANDED_BYTES - gz.length - 10, tracks: 0 }), /expands beyond/);
  assert.throws(() => expandImportArchive(bytes, "export.zip", { bytes: 0, tracks: MAX_EXPANDED_TRACKS }), /too many activities/);
  const budget = { bytes: 0, tracks: 0 };
  assert.equal(expandImportArchive(bytes, "export.zip", budget).length, 1);
  assert.equal(budget.tracks, 1);
  assert.equal(budget.bytes, gz.length + encode(GPX).length);
});

test("CSV rejects unterminated quoting and excessive metadata rows", () => {
  assert.throws(() => parseActivitiesCsv('Activity ID,Filename\n1,"a.gpx'), /unterminated/);
  assert.throws(() => parseActivitiesCsv('Activity ID,Filename\n' + '1,a.gpx\n'.repeat(20_001)), /too many rows/);
});

function streamingRequest(chunks: number[], headers: Record<string, string> = {}, onCancel = () => {}) {
  let index = 0;
  return new Request("http://localhost/api/activities/import", {
    method: "POST", headers, duplex: "half",
    body: new ReadableStream({ pull(controller) { if (index < chunks.length) controller.enqueue(new Uint8Array(chunks[index++])); else controller.close(); }, cancel: onCancel }),
  } as RequestInit);
}

test("request limit handles chunked/dishonest lengths and cancels oversized streams", async () => {
  for (const headers of [{}, { "content-length": "1" }] as Record<string, string>[]) {
    let cancelled = false;
    await assert.rejects(boundedImportRequest(streamingRequest([4, 5, 1], headers, () => { cancelled = true; }), 8), ImportBodyLimitError);
    assert.equal(cancelled, true);
  }
  assert.equal((await (await boundedImportRequest(streamingRequest([4, 4]), 8)).arrayBuffer()).byteLength, 8);
  let cancelled = false;
  await assert.rejects(boundedImportRequest(streamingRequest([1], { "content-length": "9" }, () => { cancelled = true; }), 8), ImportBodyLimitError);
  assert.equal(cancelled, true);
});

test("stalled upload is cancelled at the body deadline", async () => {
  let cancelled = false;
  const request = new Request("http://localhost/import", { method: "POST", duplex: "half", body: new ReadableStream({ cancel() { cancelled = true; } }) } as RequestInit);
  await assert.rejects(boundedImportRequest(request, 8, 10), /Upload timed out/);
  assert.equal(cancelled, true);
});

test("JSON rejects invalid file objects and malformed base64", () => {
  assert.match(filesFromJsonBody([null, 4, { filename: "a.fit", fit: "%%%=" }]).errors[2].error, /Invalid base64/);
  assert.equal(filesFromJsonBody([null, 4]).errors.length, 2);
  assert.deepEqual(filesFromJsonBody({ filename: "a.fit", fit: "AQID" }).files[0].bytes, new Uint8Array([1, 2, 3]));
});

test("malformed XML, DTD, deep XML, comment GPS and missing coordinates fail clearly", () => {
  assert.throws(() => parseGpx(GPX.slice(0, -6)), GpxError);
  assert.throws(() => parseGpx('<!DOCTYPE gpx [<!ENTITY p SYSTEM "file:///etc/passwd">]>' + GPX), /DOCTYPE/);
  assert.throws(() => parseGpx('<gpx>' + '<x>'.repeat(129) + '</x>'.repeat(129) + '</gpx>'), /nested too deeply/);
  assert.throws(() => parseGpx('<gpx><!--' + GPX + '--></gpx>'), /at least two/);
  assert.throws(() => parseGpx('<gpx><name><![CDATA[' + GPX + ']]></name></gpx>'), /at least two/);
  assert.throws(() => parseGpx('<gpx><trkpt/><trkpt lat="" lon=""/></gpx>'), /at least two/);
  assert.throws(() => parseTcx('<TrainingCenterDatabase><Track></TrainingCenterDatabase>'), TcxError);
  assert.throws(() => parseTcx('<!DOCTYPE TrainingCenterDatabase>' + '<TrainingCenterDatabase/>'), /DOCTYPE/);
});

test("FIT with valid magic but truncated data or a bad CRC fails integrity checks", () => {
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: Profile.MesgNum.FILE_ID, type: "activity", manufacturer: "development", product: 0 } as never);
  const fit = encoder.close();
  assert.throws(() => parseFit(fit, 0), /too many messages/);
  assert.throws(() => parseFit(fit.slice(0, -1)), /corrupt or truncated/);
  const corrupt = Uint8Array.from(fit);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => parseFit(corrupt), FitError);
});

test("guard bounds concurrency and attempts, expires idle state and releases idempotently", () => {
  const acquire = createImportGuard({ attempts: 2, windowMs: 1000, concurrent: 2, keys: 2 });
  const a = acquire("a", 0);
  assert.throws(() => acquire("a", 1), ImportGuardError);
  const b = acquire("b", 1);
  assert.throws(() => acquire("c", 1), ImportGuardError);
  a(); a(); b();
  acquire("a", 2)();
  assert.throws(() => acquire("a", 3), (error: unknown) => error instanceof ImportGuardError && error.retryAfter === 1);
  assert.throws(() => acquire("c", 3), ImportGuardError);
  acquire("c", 1001)();
  acquire("a", 1002)();
});

test("guard never expires an active upload and release restores global capacity", () => {
  const acquire = createImportGuard({ attempts: 1, windowMs: 1000, concurrent: 1, keys: 1 });
  const release = acquire("a", 0);
  assert.throws(() => acquire("b", 2000), ImportGuardError);
  release();
  acquire("b", 2001)();
});

test("invalid upload batches report per-file errors without reaching persistence", async () => {
  const result = await importTrackFiles("unused-test-user", [
    { filename: "bad.gpx", bytes: encode(GPX.slice(0, -6)) },
    { filename: "bad.fit", bytes: encode("bad FIT") },
    { filename: "bad.zip", bytes: zip({ "../a.gpx": GPX }) },
  ]);
  assert.equal(result.activities.length, 0);
  assert.equal(result.errors.length, 3);
  assert.equal(result.skipped, 0);
});

function endpoint(acquire = createImportGuard(), parse: (request: Request) => Promise<ParsedUploads> = async (request: Request) => {
  await boundedImportRequest(request, 8);
  return { files: [], errors: [] };
}) {
  const app = new Hono<ImportEnv>();
  app.use("*", async (c, next) => { c.set("user", { id: "upload-test" }); await next(); });
  app.post("/import", createImportHandler({ acquire, parse, importFiles: async () => { throw new Error("Unexpected persistence"); } }));
  return app;
}

test("HTTP upload endpoint returns 413 before parsing and releases capacity on failures", async () => {
  const app = endpoint(createImportGuard({ attempts: 6, windowMs: 60_000, concurrent: 1, keys: 10 }));
  const oversized = await app.request("/import", { method: "POST", body: "123456789" });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /too large/);
  assert.equal((await app.request("/import", { method: "POST", body: "1" })).status, 400);
});

test("HTTP upload endpoint rejects concurrent attempts before body parsing with Retry-After", async () => {
  const acquire = createImportGuard();
  const release = acquire("upload-test");
  let parsed = false;
  const app = endpoint(acquire, async () => { parsed = true; throw new Error("Must not parse"); });
  const response = await app.request("/import", { method: "POST", body: "1" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.equal(parsed, false);
  release();
});

test("HTTP upload endpoint returns clear errors for malformed JSON and invalid base64", async () => {
  const app = endpoint(createImportGuard(), async request => {
    const body = await request.json();
    return filesFromJsonBody(body);
  });
  assert.equal((await app.request("/import", { method: "POST", body: "{" })).status, 400);
  const failed = await app.request("/import", { method: "POST", body: JSON.stringify([{ filename: "bad.fit", fit: "%%%=" }]) });
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /bad.fit: Invalid base64/);
});

test("JSON excess-file reporting stays bounded for large arrays", () => {
  const result = filesFromJsonBody(Array.from({ length: 1000 }, (_, i) => ({ filename: `${i}.gpx`, gpx: GPX })));
  assert.equal(result.files.length, 256);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /Only 256/);
});

test("HTTP handler preserves skipped successes alongside parse failures", async () => {
  const app = new Hono<ImportEnv>();
  app.use("*", async (c, next) => { c.set("user", { id: "partial-user" }); await next(); });
  app.post("/import", createImportHandler({
    acquire: createImportGuard(),
    parse: async () => ({ files: [{ filename: "ok.gpx", bytes: encode(GPX) }], errors: [{ filename: "bad.fit", error: "Invalid base64" }] }),
    importFiles: async () => ({ activities: [], skipped: 1, errors: [] }),
  }));
  const response = await app.request("/import", { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { activities: [], skipped: 1, errors: [{ filename: "bad.fit", error: "Invalid base64" }] });
});

test("ZIP supports streaming data descriptors and Unicode activity filenames", () => {
  const chunks: Uint8Array[] = [];
  const archive = new Zip((error, data) => { assert.ifError(error); chunks.push(data); });
  const track = new ZipDeflate("rides/café.gpx");
  archive.add(track);
  track.push(encode(GPX), true);
  archive.end();
  const tracks = expandImportArchive(Buffer.concat(chunks));
  assert.equal(tracks[0].filename, "café.gpx");
  assert.equal(parseGpx(new TextDecoder().decode(tracks[0].bytes)).points.length, 2);
});

test("XML point count is rejected during validation using a bounded 2.3 MiB fixture", () => {
  assert.throws(() => parseGpx('<gpx>' + '<trkpt/>'.repeat(MAX_XML_POINTS + 1) + '</gpx>'), /too many GPS points/);
});
