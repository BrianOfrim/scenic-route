import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { canClaimBootstrap, maybeBootstrapUser } from "./bootstrap";

test("bootstrap email matches the configured account, or the first user when unset", () => {
  const previous = process.env.BOOTSTRAP_EMAIL;
  delete process.env.BOOTSTRAP_EMAIL;
  assert.equal(canClaimBootstrap("anyone@example.com"), true);
  process.env.BOOTSTRAP_EMAIL = "Owner@example.com";
  assert.equal(canClaimBootstrap("owner@example.com"), true);
  assert.equal(canClaimBootstrap("other@example.com"), false);
  if (previous == null) delete process.env.BOOTSTRAP_EMAIL;
  else process.env.BOOTSTRAP_EMAIL = previous;
});

import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting, query, withTransaction } from "./db";
import { deleteAccountRows } from "./accountDeletion";
import { useBootstrapFixture } from "./bootstrapFixture.test-support";

const { root, store } = useBootstrapFixture();
const owner = { id: "fixture-owner", email: "owner@example.com" };
const other = { id: "fixture-other", email: "other@example.com" };
beforeEach(async () => {
  await query("DELETE FROM settings");
  await query("DELETE FROM activities");
  await query('DELETE FROM "user"');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
});
async function pendingActivity() {
  await query(`INSERT INTO activities (user_id, id, name, type, sport_type, start_date, distance)
    VALUES ('__pending__', 1, 'Legacy ride', 'Ride', 'Ride', '2026-10-01', 1)`);
}
function legacyPoster() {
  fs.writeFileSync(path.join(root, "legacy.json"), JSON.stringify({ activityId: 1 }));
  fs.writeFileSync(path.join(root, "legacy.png"), "private fixture image");
}

test("claimed installations reject every kind of legacy leftover without transferring ownership", async () => {
  const leftovers = [
    () => setSetting("strava_tokens", "fixture-token"),
    () => setSetting("sync_state", "fixture-sync"),
    pendingActivity,
    async () => legacyPoster(),
  ];
  for (const seed of leftovers) {
    await query("DELETE FROM settings");
    await query("DELETE FROM activities");
    await setSetting("bootstrap_claimed", owner.id);
    await seed();
    await assert.rejects(maybeBootstrapUser(other), /unscoped data remains after bootstrap/);
    assert.equal(await getSetting("bootstrap_claimed"), owner.id);
    assert.equal((await query("SELECT * FROM activities WHERE user_id = $1", [other.id])).length, 0);
    assert.equal((await store.listJsonNames(other.id)).length, 0);
  }
  assert.equal(fs.readFileSync(path.join(root, "legacy.png"), "utf8"), "private fixture image");
});

test("only the configured owner claims legacy activities and posters; clean claimed requests succeed", async () => {
  const previous = process.env.BOOTSTRAP_EMAIL;
  process.env.BOOTSTRAP_EMAIL = owner.email;
  try {
    await pendingActivity(); legacyPoster();
    await maybeBootstrapUser(other);
    assert.equal(await getSetting("bootstrap_claimed"), null);
    assert.equal(await store.hasUnscopedPosters(), true);
    await maybeBootstrapUser(owner);
    assert.equal(await getSetting("bootstrap_claimed"), owner.id);
    assert.equal(await store.hasUnscopedPosters(), false);
    assert.equal((await query("SELECT * FROM activities WHERE user_id = $1", [owner.id])).length, 1);
    assert.equal(JSON.parse((await store.get(owner.id, "legacy.json"))!.toString()).userId, owner.id);
    assert.equal((await store.get(owner.id, "legacy.png"))!.toString(), "private fixture image");
    await maybeBootstrapUser(other);
    assert.equal((await store.listJsonNames(other.id)).length, 0);
  } finally {
    if (previous === undefined) delete process.env.BOOTSTRAP_EMAIL;
    else process.env.BOOTSTRAP_EMAIL = previous;
  }
});

test("deleting the bootstrap owner retains the claim and prevents legacy data from being reclaimed", async () => {
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [owner.id, owner.email]);
  await setSetting("bootstrap_claimed", owner.id);
  await withTransaction(client => deleteAccountRows(client, owner));
  assert.equal(await getSetting("bootstrap_claimed"), "deleted");
  await maybeBootstrapUser(other);
  await pendingActivity(); legacyPoster();
  await assert.rejects(maybeBootstrapUser(other), /unscoped data remains after bootstrap/);
  assert.equal(await getSetting("bootstrap_claimed"), "deleted");
  assert.equal((await query("SELECT * FROM activities WHERE user_id = '__pending__'")).length, 1);
  assert.equal(await store.hasUnscopedPosters(), true);
  assert.equal((await store.listJsonNames(other.id)).length, 0);
});
