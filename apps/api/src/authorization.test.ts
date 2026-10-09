import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createApiApp } from "./index";
import { recordParticipation } from "./participation";
import { closeDb, initDb, query } from "./db";
import { closeAccountLocks } from "./accountLifecycle";
import { createLocalStore, resetPosterStore } from "./storage";
import { getActivity, deleteImportedByIds } from "./activities";
import { buildInitialPoster } from "./planner";
import type { AuthUser } from "./auth";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-authorization-"));
const store = createLocalStore(root);
const users = ["alice", "bob"].map(name => ({ id: `authorization-${name}-${randomUUID()}`, email: `${name}-${randomUUID()}@example.com` }));
const [alice, bob] = users;
const posterId = "20261008T000000Z-abcdef";
const spec = buildInitialPoster({ activity: {}, title: "Alice private ride", subtitle: "", stats: [], style: { id: "test", label: "Test", prompt: "Test" }, aspectRatio: "3:4", grounding: [{ index: 1, role: "route-only", legend: "" }], geography: [], pois: [] }).spec;
const app = createApiApp(async headers => users.find(user => headers.get("Cookie") === `test-user=${user.id}`) ?? null);
const request = (user: AuthUser | null, url: string, method = "GET", body?: unknown, origin = "http://localhost:5174") => app.request(url, {
  method, headers: { ...(user ? { Cookie: `test-user=${user.id}` } : {}), Origin: origin, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const policyEnv = ["TERMS_VERSION", "AI_CONSENT_VERSION", "TERMS_ROUTE", "PRIVACY_ROUTE"] as const;
const previousPolicy = policyEnv.map(name => process.env[name]);
before(async () => {
  // These integration tests use the default local database only, never account credentials.
  assert.ok(!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).hostname === "127.0.0.1" || new URL(process.env.DATABASE_URL).hostname === "localhost");
  process.env.TERMS_VERSION = "test-reviewed-terms-v1";
  process.env.AI_CONSENT_VERSION = "test-ai-v1";
  process.env.TERMS_ROUTE = "/terms";
  process.env.PRIVACY_ROUTE = "/privacy";
  await initDb();
  resetPosterStore(store);
  for (const user of users) {
    await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [user.id, user.email]);
    await recordParticipation(user.id, { eligible: true, terms: true, ai: true, termsVersion: "test-reviewed-terms-v1", aiVersion: "test-ai-v1" });
    await query(`INSERT INTO activities (user_id, id, name, type, sport_type, start_date, distance, imported, latlng) VALUES ($1, 42, $2, 'Ride', 'Ride', '2026-10-08', 100, 1, '[[51,-115],[51.1,-115.1]]')`, [user.id, user === alice ? "Alice private ride" : "Bob private ride"]);
  }
  await store.put(alice.id, `${posterId}.json`, Buffer.from(JSON.stringify({ posterId, userId: alice.id, activityId: 42, title: "Alice private ride", spec, prompt: "private", referenceCount: 1 })), "application/json");
  await store.put(alice.id, `${posterId}.png`, Buffer.from("private image"), "image/png");
  await store.put(alice.id, `${posterId}.thumb.webp`, Buffer.from("private thumbnail"), "image/webp");
  await store.put(alice.id, `${posterId}.ref-1.png`, Buffer.from("private grounding"), "image/png");
});
after(async () => {
  policyEnv.forEach((name, index) => {
    if (previousPolicy[index] === undefined) delete process.env[name];
    else process.env[name] = previousPolicy[index];
  });
  await query('DELETE FROM activities WHERE user_id = ANY($1::text[])', [users.map(user => user.id)]);
  await query('DELETE FROM activity_file_ids WHERE user_id = ANY($1::text[])', [users.map(user => user.id)]);
  await query('DELETE FROM settings WHERE key = ANY($1::text[])', [users.flatMap(user => [`imported_id_next:${user.id}`, `poster_activity_rebind_v1:${user.id}`])]);
  await query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users.map(user => user.id)]);
  resetPosterStore();
  fs.rmSync(root, { recursive: true, force: true });
  await closeAccountLocks();
  await closeDb();
});

const mutations: [string, string][] = [
  ["POST", "/api/activities/import"], ["POST", "/api/activities/remove"],
  ["POST", "/api/poster/landmark"], ["POST", "/api/poster/references"], ["POST", "/api/poster/plan"],
  ["POST", "/api/poster/generate"], ["POST", "/api/poster/modify"], ["POST", "/api/poster/variant"],
  ["POST", "/api/poster/jobs"], ["POST", "/api/poster/jobs/guessed/retry"], ["DELETE", "/api/poster/jobs/guessed"],
  ["PATCH", `/api/posters/${posterId}`], ["DELETE", `/api/posters/${posterId}`], ["DELETE", "/api/account"],
];
test("every protected mutation rejects anonymous and foreign-origin requests before dispatch", async () => {
  for (const [method, url] of mutations) {
    assert.equal((await request(null, url, method, {})).status, 401, `${method} ${url}`);
    assert.equal((await request(alice, url, method, {}, "https://sibling.attacker.example")).status, 403, `${method} ${url}`);
  }
  const crossSite = await app.request("/api/activities/remove", { method: "POST", headers: { Cookie: `test-user=${alice.id}`, "Sec-Fetch-Site": "cross-site" }, body: "{}" });
  assert.equal(crossSite.status, 403);
});

test("activity IDs are resolved inside the session account, including overlapping IDs", async () => {
  for (const user of users) {
    const response = await request(user, "/api/activities/42");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).activity.name, user === alice ? "Alice private ride" : "Bob private ride");
  }
  await query('INSERT INTO activities (user_id, id, name, type, sport_type, start_date, distance, imported) VALUES ($1, 99, $1, $1, $1, $1, 1, 1)', [alice.id]);
  assert.equal(await getActivity(bob.id, 99), null);
  for (const url of ["/api/activities/99", "/api/poster/location/99", "/api/poster/geography/99"]) assert.equal((await request(bob, url)).status, 404);
  const context = await request(bob, "/api/poster/context/99");
  assert.equal(context.status, 400);
  assert.match((await context.json()).error, /not found/);
  const landmark = await request(bob, "/api/poster/landmark", "POST", { activityId: 99, query: "peak" });
  assert.equal(landmark.status, 400);
  assert.match((await landmark.json()).error, /not found/);
  const generation = await request(bob, "/api/poster/generate", "POST", { activityId: 99, spec, references: ["data:image/png;base64,iVBORw0KGgo="] });
  assert.equal(generation.status, 404);
  assert.deepEqual((await deleteImportedByIds(bob.id, [99])).deleted, []);
  assert.ok(await getActivity(alice.id, 99));
  const removed = await request(bob, "/api/activities/remove", "POST", { ids: [42, 99], userId: alice.id });
  assert.equal(removed.status, 200);
  assert.ok(await getActivity(alice.id, 42));
  assert.equal(await getActivity(bob.id, 42), null);
});

test("guessed poster IDs cannot read, share/download, edit, delete or generate from another account", async () => {
  for (const suffix of ["", "/image.png", "/thumb.webp", "/ref-1.png"]) {
    const url = `/api/posters/${posterId}${suffix}`;
    assert.equal((await request(null, url)).status, 401);
    assert.equal((await request(bob, url)).status, 404);
    const own = await request(alice, url);
    assert.equal(own.status, 200);
    if (suffix) assert.equal(own.headers.get("cache-control"), "private, no-store");
  }
  assert.equal((await request(bob, `/api/posters/${posterId}`, "PATCH", { favorited: true, userId: alice.id })).status, 404);
  assert.equal((await request(bob, `/api/posters/${posterId}`, "DELETE")).status, 404);
  for (const endpoint of ["modify", "variant"]) {
    assert.equal((await request(bob, `/api/poster/${endpoint}`, "POST", { posterId, request: "steal", userId: alice.id })).status, 404);
  }
  assert.ok(await store.get(alice.id, `${posterId}.png`));
  assert.equal(JSON.parse((await store.get(alice.id, `${posterId}.json`))!.toString()).favorited, undefined);
  const ownFavorite = await request(alice, `/api/posters/${posterId}`, "PATCH", { favorited: true });
  assert.equal(ownFavorite.status, 200);
  assert.equal((await ownFavorite.json()).favorited, true);
  // Static hosting must never expose the object root outside /api authorization.
  for (const url of [`/data/posters/${alice.id}/${posterId}.png`, `/posters/${alice.id}/${posterId}.png`]) {
    const response = await request(null, url);
    assert.notEqual(await response.text(), "private image");
  }
});

test("persisted images cannot authorize client-supplied remote references", async () => {
  const response = await request(alice, "/api/poster/generate", "POST", {
    activityId: 42, spec, references: ["https://private.example/guessed-image.png"],
    persistReferences: ["data:image/png;base64,iVBORw0KGgo="],
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /base64 data URLs/);
});
