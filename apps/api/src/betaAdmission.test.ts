import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import pg from "pg";
import { betterAuth } from "better-auth";
import { Hono } from "hono";
import { authOptions, createRequireUser } from "./auth";
import { admitBetaUser, getBetaStatus } from "./betaAdmission";
import { AccountUnavailableError, withAccountAccess, closeAccountLocks } from "./accountLifecycle";
import { closeDb, databaseUrl, getPool, query, queryOne, withTransaction } from "./db";

// Never run cap-filling fixtures in an application database. Each test process
// creates and drops its own local database, even when the suite runs in parallel.
const base = new URL(databaseUrl());
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Beta tests require a local PostgreSQL server.");
}
const dbName = "beta_test_" + randomUUID().replaceAll("-", "");
const admin = new pg.Pool({ connectionString: base.href });
before(async () => {
  await admin.query(`CREATE DATABASE "${dbName}"`);
  base.pathname = "/" + dbName;
  process.env.DATABASE_URL = base.href;
  const legacy = new pg.Pool({ connectionString: base.href });
  await legacy.query(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL, image TEXT, "createdAt" TIMESTAMPTZ DEFAULT now(), "updatedAt" TIMESTAMPTZ DEFAULT now());
    INSERT INTO "user" (id,name,email,"emailVerified") VALUES ('legacy','Legacy','legacy@example.com',false);
  `);
  await legacy.end();
  await getPool();
});
after(async () => {
  await closeAccountLocks();
  await closeDb();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});
async function add(id: string, verified = false) {
  await query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$1,$2,$3)', [id, id + "@example.com", verified]);
}
async function clear() { await query('DELETE FROM "user"'); }
async function used() {
  return (await queryOne<{ used: number }>("SELECT used FROM beta_capacity"))!.used;
}
async function fill(n: number) {
  for (let i = 0; i < n; i++) await add("existing-" + i);
}
async function fixture() {
  const options = authOptions(await getPool());
  const auth = betterAuth({
    ...options, logger: { disabled: true },
    socialProviders: { google: { clientId: "test", clientSecret: "test", verifyIdToken: async () => true } },
    emailVerification: { ...options.emailVerification, sendVerificationEmail: async () => {} },
  });
  const post = (path: string, body: unknown) => auth.handler(new Request("http://localhost:5174/api/auth/" + path, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" },
    body: JSON.stringify(body),
  }));
  const google = (id: string) => post("sign-in/social", {
    provider: "google", idToken: { token: "header." + Buffer.from(JSON.stringify({
      sub: id, email: id + "@example.com", email_verified: true, name: id,
    })).toString("base64url") + ".signature" },
  });
  return { post, google };
}

test("migration reserves existing unverified accounts and is repeatable", async () => {
  assert.equal(await used(), 1);
  assert.equal(await getBetaStatus("legacy"), "admitted");
  await closeDb();
  await getPool();
  assert.equal(await used(), 1);
});

test("password and Google race for the last place; auth input cannot bypass the cap", async () => {
  await clear();
  await fill(99); // Unverified accounts reserve places too.
  const { post, google } = await fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2
    ? google("google-" + i)
    : post("sign-up/email", { name: "Rider", email: "email-" + i + "@example.com",
      password: "long-test-password", beta_status: "admitted", beta_exempt: true })));
  for (const response of responses) assert.equal(response.status, 200, await response.text());
  assert.equal(await used(), 100);
  const rows = await query<{ beta_status: string; beta_exempt: boolean }>(
    `SELECT beta_status,beta_exempt FROM "user" WHERE id NOT LIKE 'existing-%'`,
  );
  assert.equal(rows.length, 12);
  assert.equal(rows.filter(r => r.beta_status === "admitted").length, 1);
  assert.equal(rows.filter(r => r.beta_status === "waiting").length, 11);
  assert.ok(rows.every(r => !r.beta_exempt));
});

test("each auth method gets admission with room and waitlist when full; returning Google keeps its place", async () => {
  await clear();
  const { post, google } = await fixture();
  await post("sign-up/email", { name: "Email", email: "open-email@example.com", password: "long-test-password" });
  await google("open-google");
  assert.equal(await used(), 2);
  for (let i = 0; i < 98; i++) await add("filler-" + i);
  await google("open-google");
  assert.equal(await used(), 100);
  await google("waiting-google");
  await post("sign-up/email", { name: "Wait", email: "waiting-email@example.com", password: "long-test-password" });
  const waiting = await query<{ email: string }>(`SELECT email FROM "user" WHERE beta_status = 'waiting' ORDER BY email`);
  assert.deepEqual(waiting.map(r => r.email), ["waiting-email@example.com", "waiting-google@example.com"]);
});

test("operator admissions race, fail when full, and deletion refunds only counted accounts", async () => {
  await clear();
  await fill(100);
  await add("wait-a"); await add("wait-b");
  await assert.rejects(admitBetaUser("wait-a@example.com"), /beta is full/i);
  await query('DELETE FROM "user" WHERE id = $1', ["wait-b"]);
  assert.equal(await used(), 100);
  await add("wait-b");
  await query('DELETE FROM "user" WHERE id = $1', ["existing-0"]);
  const outcomes = await Promise.allSettled([admitBetaUser("wait-a@example.com"), admitBetaUser("wait-b@example.com")]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await used(), 100);
  await assert.rejects(admitBetaUser("absent@example.com"), /No account/);
  await query('UPDATE "user" SET beta_exempt = true WHERE id = $1', ["existing-1"]);
  assert.equal(await used(), 99);
  await add("replacement");
  assert.equal(await getBetaStatus("replacement"), "admitted");
  await query('DELETE FROM "user" WHERE id = $1', ["existing-1"]);
  assert.equal(await used(), 100);
});

test("rolled back reservations refund capacity", async () => {
  await clear();
  await assert.rejects(withTransaction(async client => {
    await client.query(`INSERT INTO "user" (id,name,email,"emailVerified") VALUES ('rollback','Rider','rollback@example.com',false)`);
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(await used(), 0);
  await add("after-rollback");
  assert.equal(await used(), 1);
});

test("waitlisted sessions cannot import, generate, or read another account; status is self-only", async () => {
  await clear(); await fill(100); await add("waiting");
  let called = 0;
  const app = new Hono();
  app.use("/api/*", createRequireUser(async headers => ({
    id: headers.get("X-Test-User") ?? "waiting", email: "waiting@example.com",
  })));
  app.all("/api/*", c => { called++; return c.json({ ok: true }); });
  for (const [route, method] of [
    ["/api/activities/import", "POST"], ["/api/poster/jobs", "POST"], ["/api/poster/generate", "POST"],
    ["/api/poster/jobs/job/retry", "POST"], ["/api/poster/variant", "POST"], ["/api/poster/plan", "POST"],
    ["/api/activities", "GET"], ["/api/posters", "GET"], ["/api/status", "GET"],
    ["/api/beta/admit", "POST"],
  ]) {
    const response = await app.request(route, { method });
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).code, "BETA_WAITLISTED");
  }
  assert.equal(called, 0);
  await assert.rejects(withAccountAccess("waiting", false, async () => { called++; }),
    (error: unknown) => error instanceof AccountUnavailableError && error.status === 403);
  assert.equal(called, 0);
  const own = await app.request("/api/beta?userId=existing-0&email=existing-0@example.com");
  assert.deepEqual(await own.json(), { status: "waiting", cap: 100 });
  assert.deepEqual(await (await app.request("/api/beta", { headers: { "X-Test-User": "existing-0" } })).json(),
    { status: "admitted", cap: 100 });
  assert.equal((await app.request("/api/activities", { headers: { "X-Test-User": "existing-0" } })).status, 200);
  assert.equal(called, 1);
  // A waiting account can still invoke account deletion; it never bootstraps.
  assert.equal((await app.request("/api/account", { method: "DELETE" })).status, 200);
});

test("operator CLI requires exact configured operator ID for exemption; ordinary admissions stay capped", async () => {
  await clear(); await fill(100); await add("operator"); await add("waiting-cli");
  const run = (email: string, exempt = false, operator = "") => promisify(execFile)(
    process.execPath, ["--import", "tsx", "scripts/admit-beta.mts", email, ...(exempt ? ["--exempt-operator"] : [])],
    { cwd: new URL("../../..", import.meta.url).pathname, env: { ...process.env, BETA_OPERATOR_USER_ID: operator } },
  );
  await assert.rejects(run("waiting-cli@example.com"), /beta is full/i);
  await assert.rejects(run("operator@example.com", true), /Set BETA_OPERATOR_USER_ID/);
  await assert.rejects(run("waiting-cli@example.com", true, "operator"), /does not match/);
  const result = await run("operator@example.com", true, "operator");
  assert.match(result.stdout, /No invitation email was sent/);
  assert.equal(await getBetaStatus("operator"), "admitted");
  assert.equal(await getBetaStatus("waiting-cli"), "waiting");
  assert.equal(await used(), 100);
  await query('DELETE FROM "user" WHERE id = $1', ["existing-0"]);
  await run("waiting-cli@example.com");
  assert.equal(await used(), 100);
  assert.equal(await getBetaStatus("waiting-cli"), "admitted");
});
