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
import sharp from "sharp";

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
  await store.put(alice.id, `${posterId}.annotation.png`, Buffer.from("private annotation"), "image/png");
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
  for (const suffix of ["", "/image.png", "/thumb.webp", "/ref-1.png", "/annotation.png"]) {
    const url = `/api/posters/${posterId}${suffix}`;
    assert.equal((await request(null, url)).status, 401);
    assert.equal((await request(bob, url)).status, 404, url);
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

test("annotated refinement retains the exact provider input independently of its source", async t => {
  const sourceId = "20261010T140000Z-ab1234";
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const png = await sharp({ create: { width: 100, height: 150, channels: 3, background: "white" } }).png().toBuffer();
  let annotatedInput: Buffer | undefined;
  let outputId: string | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/images/models")) return Response.json({ data: [{ id: "google/gemini-test-image", max_input_references: 3, max_images: 1 }] });
    if (url.endsWith("/endpoints")) return Response.json({ data: { max_input_references: 3 } });
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    const body = JSON.parse(String(init?.body));
    annotatedInput = Buffer.from(body.input_references[1].image_url.url.split(",")[1], "base64");
    return Response.json({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }] });
  });
  try {
    await store.put(alice.id, `${sourceId}.json`, Buffer.from(JSON.stringify({
      posterId: sourceId, userId: alice.id, activityId: 42, title: "Saved ride", subtitle: "",
      spec, prompt: "Saved brief", referenceCount: 1, model: "google/gemini-test-image", aspectRatio: "3:4",
    })), "application/json");
    await store.put(alice.id, `${sourceId}.png`, png, "image/png");
    await store.put(alice.id, `${sourceId}.ref-1.png`, png, "image/png");
    const response = await request(alice, "/api/poster/modify", "POST", {
      posterId: sourceId, request: "Darken this area", variants: 1,
      annotation: [[{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }]],
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    const output = payload.posters[0];
    outputId = output.posterId;
    assert.equal(output.annotationUrl, `/api/posters/${outputId}/annotation.png`);
    assert.equal(output.referenceCount, 1, "annotation is not a geographic reference");
    const record = JSON.parse((await store.get(alice.id, `${outputId}.json`))!.toString());
    assert.equal(record.annotationUrl, output.annotationUrl);
    const page = await (await request(alice, "/api/posters/page")).json();
    assert.equal(page.posters.find((p: { posterId: string }) => p.posterId === outputId).annotationUrl, output.annotationUrl);
    await store.removeByPosterId(alice.id, sourceId);
    const saved = await request(alice, output.annotationUrl);
    assert.equal(saved.status, 200);
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()), annotatedInput);
    assert.equal((await request(bob, output.annotationUrl)).status, 404);
    assert.equal((await request(null, output.annotationUrl)).status, 401);
    await store.removeByPosterId(alice.id, outputId!);
    assert.equal((await request(alice, output.annotationUrl)).status, 404);
  } finally {
    await store.removeByPosterId(alice.id, sourceId);
    if (outputId) await store.removeByPosterId(alice.id, outputId);
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test("gallery pages are account scoped and return only slim poster metadata", async () => {
  assert.equal((await request(null, "/api/posters/page")).status, 401);
  const foreign = await request(bob, "/api/posters/page");
  assert.equal(foreign.status, 200);
  assert.deepEqual(await foreign.json(), { posters: [], nextCursor: null });
  const own = await request(alice, "/api/posters/page");
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  const page = await own.json();
  assert.deepEqual(page.posters.map((p: { posterId: string }) => p.posterId), [posterId]);
  assert.equal(page.posters[0].spec, undefined);
  assert.equal(page.posters[0].prompt, undefined);
  assert.equal(page.nextCursor, null);
  assert.equal((await request(alice, "/api/posters/page?before=..%2Fbad")).status, 400);
});

test("gallery first page reads only 24 records and older pages have no duplicates", async () => {
  const ids = Array.from({ length: 30 }, (_, index) => `20261010T${String(index).padStart(6, "0")}Z-abcdef`);
  let reads = 0;
  try {
    for (const id of ids) {
      await store.put(alice.id, `${id}.json`, Buffer.from(JSON.stringify({
        posterId: id, userId: alice.id, activityId: 42, title: "Test page", createdAt: id,
      })), "application/json");
    }
    resetPosterStore({ ...store, async get(userId, name) {
      if (name.endsWith(".json")) reads += 1;
      return store.get(userId, name);
    } });
    const first = await (await request(alice, "/api/posters/page")).json();
    assert.equal(first.posters.length, 24);
    assert.equal(reads, 24);
    const second = await (await request(alice, `/api/posters/page?before=${first.nextCursor}`)).json();
    assert.equal(second.posters.length, 7);
    assert.equal(second.nextCursor, null);
    const allIds = [...first.posters, ...second.posters].map(p => p.posterId);
    assert.equal(new Set(allIds).size, 31);
    assert.ok(allIds.includes(posterId));
  } finally {
    resetPosterStore(store);
    for (const id of ids) await store.removeByPosterId(alice.id, id);
  }
});

test("owned saved posters can be refined or varied after their activity is removed", async t => {
  const sourceId = "20261010T120000Z-ab1234";
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const providerCalls: { prompt: string; input_references: unknown[] }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/images/models")) return Response.json({ data: [{ id: "google/gemini-test-image", max_input_references: 3, max_images: 1 }] });
    if (url.endsWith("/endpoints")) return Response.json({ data: { max_input_references: 3 } });
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    providerCalls.push(JSON.parse(String(init?.body)));
    // Stop at the provider boundary: no real generation, costs, or saved outputs.
    return Response.json({ error: { message: "Test provider reached" } }, { status: 400 });
  });
  try {
    await store.put(alice.id, `${sourceId}.json`, Buffer.from(JSON.stringify({
      posterId: sourceId, userId: alice.id, activityId: 999999, title: "Saved ride", subtitle: "",
      spec, prompt: "Saved brief", referenceCount: 1, model: "google/gemini-test-image", aspectRatio: "3:4",
    })), "application/json");
    await store.put(alice.id, `${sourceId}.png`, Buffer.from("saved artwork"), "image/png");
    await store.put(alice.id, `${sourceId}.ref-1.png`, Buffer.from("saved grounding"), "image/png");
    for (const endpoint of ["modify", "variant"]) {
      const body = { posterId: sourceId, request: "Make the route green", variants: 1 };
      assert.equal((await request(bob, `/api/poster/${endpoint}`, "POST", body)).status, 404);
      const own = await request(alice, `/api/poster/${endpoint}`, "POST", body);
      assert.equal(own.status, 502);
      assert.match((await own.json()).error, /Test provider reached/);
    }
    assert.equal(providerCalls.length, 2);
    assert.equal(providerCalls[0].input_references.length, 2);
    assert.match(providerCalls[0].prompt, /Make the route green/);
    assert.equal(providerCalls[1].input_references.length, 1);
    const fresh = await request(alice, "/api/poster/generate", "POST", {
      activityId: 999999, spec, references: ["data:image/png;base64,c2F2ZWQ="],
      source: { userId: alice.id, activityId: 999999 },
    });
    assert.equal(fresh.status, 404);
    assert.match((await fresh.json()).error, /activity not found/);
    assert.equal(providerCalls.length, 2);
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    await store.removeByPosterId(alice.id, sourceId);
  }
});
