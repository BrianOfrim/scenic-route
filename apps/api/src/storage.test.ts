import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLocalStore } from "./storage";

test("local object store scopes poster files by user id", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-store-"));
  const store = createLocalStore(root);
  await store.put("user-a", "20260101T000000Z-abc123.json", Buffer.from('{"ok":true}'), "application/json");
  await store.put("user-a", "20260101T000000Z-abc123.png", Buffer.from("png"), "image/png");
  await store.put("user-a", "20260101T000000Z-abc123.ref-1.png", Buffer.from("ref"), "image/png");
  await store.put("user-b", "other.json", Buffer.from("{}"), "application/json");

  assert.deepEqual(await store.listJsonNames("user-a"), ["20260101T000000Z-abc123.json"]);
  assert.deepEqual(await store.listJsonNames("user-b"), ["other.json"]);
  assert.equal((await store.get("user-a", "20260101T000000Z-abc123.png"))?.toString(), "png");
  assert.equal(await store.get("user-b", "20260101T000000Z-abc123.png"), null);
  assert.equal(await store.get("user-a", "missing.png"), null);

  await store.removeByPosterId("user-a", "20260101T000000Z-abc123");
  assert.deepEqual(await store.listJsonNames("user-a"), []);
  assert.equal(await store.get("user-a", "20260101T000000Z-abc123.png"), null);
  assert.equal((await store.get("user-b", "other.json"))?.toString(), "{}");
});

test("local store migrates unscoped poster keys onto a user prefix", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-store-"));
  fs.writeFileSync(path.join(root, "legacy.json"), '{"posterId":"legacy"}');
  fs.writeFileSync(path.join(root, "legacy.png"), "png");
  const store = createLocalStore(root);
  assert.equal(await store.hasUnscopedPosters(), true);
  await store.migrateUnscopedToUser("owner-1");
  assert.equal(await store.hasUnscopedPosters(), false);
  assert.deepEqual(await store.listJsonNames("owner-1"), ["legacy.json"]);
  assert.match((await store.get("owner-1", "legacy.json"))!.toString(), /"userId": "owner-1"/);
  assert.equal((await store.get("owner-1", "legacy.png"))?.toString(), "png");
  assert.equal(fs.existsSync(path.join(root, "legacy.json")), false);
});
