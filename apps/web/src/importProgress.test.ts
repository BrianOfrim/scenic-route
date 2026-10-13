import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityList } from "./ActivityList";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readImportEvents } from "./importProgress";
import { importActivityFiles, ImportRequestError } from "./api";

function response(events: unknown[], chunkSize = 1) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join("\n"));
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset += chunkSize));
    },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}

test("import stream decodes split JSON and Unicode, including a final line without newline", async () => {
  const events = [{ type: "progress", processed: 1 }, { type: "error", error: "vélo.gpx" }];
  const actual = [];
  for await (const event of readImportEvents(response(events).body!)) actual.push(event);
  assert.deepEqual(actual, events);
});

test("import client reports live counts and returns the final result", async t => {
  const progress = { processed: 2, total: 3, imported: 1, skipped: 1, failed: 0 };
  const result = { activities: [], errors: [], skipped: 3 };
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Accept"), "application/x-ndjson");
    return response([{ type: "preparing" }, { type: "progress", ...progress }, { type: "result", ...result }], 13);
  });
  const statuses: unknown[] = [];
  assert.deepEqual(await importActivityFiles([], status => statuses.push(status)), result);
  assert.equal((statuses[2] as { progress: { processed: number } }).progress.processed, 2);
});

test("import client preserves streamed per-file failures", async t => {
  const errors = [{ filename: "bad.gpx", error: "Invalid track" }];
  t.mock.method(globalThis, "fetch", async () => response([{ type: "error", error: "Invalid track", errors, skipped: 0 }]));
  await assert.rejects(importActivityFiles([]), error => error instanceof ImportRequestError && error.failures[0].filename === "bad.gpx");
});

test("import client detects a disconnected stream instead of reporting success", async t => {
  t.mock.method(globalThis, "fetch", async () => response([{ type: "preparing" }]));
  await assert.rejects(importActivityFiles([]), /ended before completion/);
});

test("import client remains compatible with JSON responses", async t => {
  const result = { activities: [], errors: [], skipped: 1 };
  t.mock.method(globalThis, "fetch", async () => Response.json(result));
  assert.deepEqual(await importActivityFiles([]), result);
});


test("import panel shows real counts and suppresses empty-state instructions while busy", () => {
  const html = renderToStaticMarkup(createElement(ActivityList, {
    activities: [], loading: false, selectedId: null, importing: true,
    importStatus: { phase: "importing", progress: { processed: 37, total: 88, imported: 35, skipped: 1, failed: 1 } },
    importNotice: null, onDismissImportNotice() {}, onSelect() {}, onImport() {}, async onRemove() {},
  }));
  assert.match(html, /max="88" value="37"/);
  assert.match(html, /37 \/ 88/);
  assert.match(html, /35 imported/);
  assert.match(html, /1 already imported/);
  assert.match(html, /1 failed/);
  assert.doesNotMatch(html, /Bring your adventures here/);
});
