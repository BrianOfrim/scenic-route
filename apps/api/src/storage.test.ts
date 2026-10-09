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

test("local store removes only posters derived from selected activities", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-store-"));
  const store = createLocalStore(root);
  await store.put("user-a", "remove.json", Buffer.from('{"activityId":42}'), "application/json");
  await store.put("user-a", "remove.png", Buffer.from("png"), "image/png");
  await store.put("user-a", "keep.json", Buffer.from('{"activityId":43}'), "application/json");
  await store.put("user-b", "other.json", Buffer.from('{"activityId":42}'), "application/json");

  assert.equal(await store.removeByActivityIds("user-a", new Set([42])), 1);
  assert.deepEqual(await store.listJsonNames("user-a"), ["keep.json"]);
  assert.deepEqual(await store.listJsonNames("user-b"), ["other.json"]);
  assert.equal(await store.get("user-a", "remove.png"), null);
});

test("R2 account purge paginates, batches deletes, and rejects partial deletion failures", async t => {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const { createR2Store } = await import("./storage");
  const calls: any[] = [];
  let fail = false;
  t.mock.method(S3Client.prototype, "send", async (command: any) => {
    calls.push(command);
    if (command instanceof ListObjectsV2Command) {
      assert.equal(command.input.Prefix, "references/user-a/");
      const second = command.input.ContinuationToken === "next";
      return {
        Contents: Array.from({ length: second ? 2 : 1000 }, (_, i) => ({ Key: `references/user-a/${second ? 1000 + i : i}` })),
        IsTruncated: !second, NextContinuationToken: second ? undefined : "next",
      };
    }
    assert.ok(command instanceof DeleteObjectsCommand);
    assert.ok(command.input.Delete!.Objects!.length <= 1000);
    assert.ok(command.input.Delete!.Objects!.every((item: any) => item.Key.startsWith("references/user-a/")));
    return fail ? { Errors: [{ Key: "references/user-a/0", Code: "AccessDenied" }] } : {};
  });
  const store = createR2Store({ bucket: "test", endpoint: "https://test.example", accessKeyId: "test", secretAccessKey: "test" }, "references/");
  await store.removeUser("user-a");
  const deletes = calls.filter(command => command instanceof DeleteObjectsCommand);
  assert.deepEqual(deletes.map(command => command.input.Delete!.Objects!.length), [1000, 2]);
  fail = true;
  await assert.rejects(store.removeUser("user-a"), /Could not delete all/);
  await assert.rejects(store.removeUser("../user-b"), /invalid user id/);
});
