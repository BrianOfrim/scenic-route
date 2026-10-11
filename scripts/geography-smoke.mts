import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";
import type { GeographyScene, GeographyProfile } from "../apps/api/src/osm/geographyPolicy";

// Opt-in integration test: real API routing/middleware, local PostgreSQL, and live
// Overpass. It uses the API's existing test session lookup, never a real account.
const root = path.resolve(import.meta.dirname, "..");
config({ path: path.join(root, ".env.local"), quiet: true });
config({ path: path.join(root, ".env"), quiet: true });
const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
if (args.includes("--help")) {
  console.log("Usage: npm run test:geography:live -- [--case ID] [--output DIRECTORY] [--strict]");
  console.log("Default: all locations, isolated cold cache, then warm-query and saved-scene repeats.");
  console.log("Fallbacks are reported; --strict also fails on fallback or empty scenes. No external account required.");
  process.exit(0);
}
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--strict") continue;
  assert.ok(["--case", "--output"].includes(args[index]), `Unknown option ${args[index]}`);
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `Missing value for ${args[index]}`);
  index++;
}
const database = new URL(process.env.DATABASE_URL || "postgres://scenic:scenic@127.0.0.1:5432/scenic_route");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname), "Live geography test requires local PostgreSQL; refusing a remote database.");

type Case = { id: string; name: string; center: [number, number]; shortKm: number;
  aspect: string; profile: GeographyProfile };
const cases: Case[] = [
  { id: "central-park", name: "Central Park short run", center: [-73.97, 40.775], shortKm: 1.5, aspect: "1:1", profile: "close-up" },
  { id: "edmonton", name: "Edmonton river-valley run", center: [-113.49, 53.53], shortKm: 6, aspect: "3:4", profile: "local" },
  { id: "lake-louise", name: "Lake Louise mountain hike", center: [-116.22, 51.325], shortKm: 5, aspect: "3:4", profile: "local" },
  { id: "victoria", name: "Victoria coastal ride", center: [-123.38, 48.44], shortKm: 8, aspect: "4:3", profile: "local" },
  { id: "winnipeg", name: "Winnipeg city ride", center: [-97.14, 49.88], shortKm: 18, aspect: "2:3", profile: "town" },
  { id: "netherlands", name: "Netherlands rural ride", center: [5.25, 52.1], shortKm: 35, aspect: "16:9", profile: "district" },
  { id: "rockies", name: "Banff–Canmore regional ride", center: [-115.55, 51.15], shortKm: 65, aspect: "3:4", profile: "regional" },
  { id: "alberta", name: "Alberta multi-day overview", center: [-114, 53], shortKm: 320, aspect: "3:4", profile: "wide" },
];
const selected = value("--case") ? cases.filter(item => item.id === value("--case")) : cases;
assert.ok(selected.length, `Unknown case. Choose: ${cases.map(item => item.id).join(", ")}`);
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
const output = path.resolve(value("--output") || path.join(root, "data", "geography-smoke", runId));
await fs.mkdir(output, { recursive: true });
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-geography-live-"));
process.env.OSM_CACHE_DIR = cache;
process.env.LOG_DIR = output;
process.env.DB_MIGRATIONS = "off";
// The fixture account must never claim legacy activities from the local DB.
process.env.BOOTSTRAP_EMAIL = "bootstrap-disabled-for-geography-smoke@example.invalid";
process.env.TERMS_VERSION = "geography-smoke-terms-v1";
process.env.AI_CONSENT_VERSION = "geography-smoke-ai-v1";
process.env.TERMS_ROUTE = "/terms";
process.env.PRIVACY_ROUTE = "/privacy";

const { createApiApp } = await import("../apps/api/src/index");
const { closeDb, initDb, query } = await import("../apps/api/src/db");
const { closeAccountLocks } = await import("../apps/api/src/accountLifecycle");
const { recordParticipation } = await import("../apps/api/src/participation");
const { createLocalStore, resetPosterStore } = await import("../apps/api/src/storage");
resetPosterStore(createLocalStore(path.join(cache, "posters")));
const { geographyPolicy } = await import("../apps/api/src/osm/geographyPolicy");
const { logger, installConsoleLogging } = await import("../apps/api/src/logger");
const restoreConsoleLogging = installConsoleLogging();
const user = { id: `geography-smoke-${randomUUID()}`, email: `geography-smoke-${randomUUID()}@example.invalid` };
const cookie = `smoke-user=${user.id}`;
const app = createApiApp(async headers => headers.get("Cookie") === cookie ? user : null);
type Event = Record<string, unknown> & { event: string; loadId: string };
const events: Event[] = [];
const originalDebug = logger.debug;
logger.debug = (scope, fields) => {
  const record = originalDebug(scope, fields);
  if (scope === "geography.timing" && typeof record.event === "string" && typeof record.loadId === "string") {
    events.push({ ...record, event: record.event, loadId: record.loadId });
  }
  return record;
};
const results: Record<string, unknown>[] = [];
const failures: string[] = [];
let created = false;

function bboxFor(item: Case): [number, number, number, number] {
  const [a, b] = item.aspect.split(":").map(Number);
  const widthKm = item.shortKm * Math.max(1, a / b);
  const heightKm = item.shortKm * Math.max(1, b / a);
  const [lng, lat] = item.center;
  const dx = widthKm / (111.32 * Math.cos(lat * Math.PI / 180)) / 2;
  const dy = heightKm / 111.32 / 2;
  return [lng - dx, lat - dy, lng + dx, lat + dy].map(n => Number(n.toFixed(7))) as [number, number, number, number];
}

async function runCase(item: Case, activityId: number) {
  const bbox = bboxFor(item);
  assert.equal(geographyPolicy(bbox, item.aspect).profile, item.profile, `${item.id}: fixture scale`);
  await query(`INSERT INTO activities (user_id, id, name, type, sport_type, start_date, distance, imported, latlng)
    VALUES ($1, $2, $3, 'Ride', 'Ride', '2026-10-11', $4, 1, $5)`,
    [user.id, activityId, item.name, item.shortKm * 1000, JSON.stringify([[bbox[1], bbox[0]], item.center.slice().reverse(), [bbox[3], bbox[2]]])]);
  let savedScene: string | undefined;
  for (const phase of ["cold", "warm", "saved"] as const) {
    const params = new URLSearchParams({ bbox: JSON.stringify(bbox), aspect: item.aspect, mode: "auto" });
    if (phase === "saved" && savedScene) params.set("scene", savedScene);
    const eventStart = events.length;
    const started = performance.now();
    console.log(`${item.id} ${phase}: querying ${item.profile} geography…`);
    const errors: string[] = [];
    let scene: GeographyScene | undefined;
    let responseBytes = 0;
    let status: number | undefined;
    try {
      const response = await app.request(`/api/poster/geography/${activityId}?${params}`, { headers: { Cookie: cookie } });
      status = response.status;
      const body = await response.text();
      responseBytes = Buffer.byteLength(body);
      assert.equal(status, 200, `HTTP ${status}: ${body.slice(0, 300)}`);
      scene = JSON.parse(body);
      assert.equal(scene!.profile, item.profile);
      if (item.profile === "wide") assert.equal(scene!.source, "natural-earth");
      assert.ok(/^[a-f0-9]{64}$/.test(scene!.sceneId ?? ""), "Missing saved scene ID");
      assert.ok(scene!.bbox.every(Number.isFinite), "Non-finite frame");
      assert.ok(Object.values(scene!.ways).every(bucket => bucket.type === "FeatureCollection" && Array.isArray(bucket.features)));
      if (phase === "saved") assert.equal(scene!.sceneId, savedScene, "Saved scene should restore unchanged");
      if (args.includes("--strict")) {
        assert.notEqual(scene!.completeness, "fallback", "Detailed geography fell back");
        assert.ok(Object.values(scene!.ways).some(bucket => bucket.features.length > 0), "Scene has no features");
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    const elapsedMs = performance.now() - started;
    const timingEvents = events.slice(eventStart);
    if (phase === "cold" && item.profile !== "wide" && !timingEvents.some(event => event.event === "overpass-cache" && event.status === "miss")) errors.push("Expected a cold Overpass cache miss");
    if (phase === "warm" && results.at(-1)?.completeness !== "fallback" && timingEvents.some(event => event.event === "overpass-cache" && event.status === "miss")) errors.push("Unexpected miss on warm cache");
    if (phase === "saved" && !timingEvents.some(event => event.event === "scene-cache" && event.status === "hit")) errors.push("Expected saved-scene cache hit");
    if (item.profile === "wide" && timingEvents.some(event => event.event === "overpass-attempt")) errors.push("Wide geography should use bundled assets without Overpass");
    const complete = timingEvents.find(event => event.event === "complete");
    if (!complete) errors.push("Missing geography completion timing");
    const result = { case: item.id, name: item.name, phase, aspect: item.aspect, bbox, expectedProfile: item.profile,
      status, elapsedMs, responseBytes, source: scene?.source, completeness: scene?.completeness,
      warnings: scene?.warnings, queryResponseBytes: scene?.queryResponseBytes,
      featureCount: scene ? Object.values(scene.ways).reduce((sum, bucket) => sum + bucket.features.length, 0) : 0,
      timing: complete, attempts: timingEvents.filter(event => event.event === "overpass-attempt"), errors };
    results.push(result);
    if (errors.length) failures.push(`${item.id} ${phase}: ${errors.join("; ")}`);
    console.log(`${item.id} ${phase}: ${(elapsedMs / 1000).toFixed(2)}s · ${scene?.source ?? "error"} · ${scene?.completeness ?? status} · ${errors.length ? "FAIL" : "PASS"}`);
    if (phase === "cold") savedScene = scene?.sceneId;
    // Persist after each request, so interrupted runs retain completed results.
    await saveReport();
  }
}

async function saveReport() {
  await logger.flush();
  await fs.writeFile(path.join(output, "timings.jsonl"), events.map(event => JSON.stringify(event)).join("\n") + "\n");
  const endpointHealth = Object.fromEntries(events.filter(event => event.event === "overpass-endpoint-health")
    .map(event => [String(event.endpoint), event]));
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ runId, startedAt,
    execution: "real API handler with disposable local test session; live Overpass; isolated cache",
    strict: args.includes("--strict"), results, endpointHealth, failures }, null, 2));
}

try {
  await initDb();
  await query(`INSERT INTO "user" (id, name, email, "emailVerified", beta_status, beta_exempt)
    VALUES ($1, 'Geography smoke test', $2, true, 'admitted', true)`, [user.id, user.email]);
  created = true;
  await recordParticipation(user.id, { eligible: true, terms: true, ai: true,
    termsVersion: process.env.TERMS_VERSION, aiVersion: process.env.AI_CONSENT_VERSION });
  assert.equal((await app.request("/api/poster/geography/1")).status, 401, "Anonymous API access must remain blocked");
  for (const [index, item] of selected.entries()) await runCase(item, index + 1);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  logger.debug = originalDebug;
  try {
    if (created) {
      await query('DELETE FROM activities WHERE user_id = $1', [user.id]);
      await query('DELETE FROM activity_file_ids WHERE user_id = $1', [user.id]);
      await query('DELETE FROM settings WHERE key = ANY($1::text[])', [[`imported_id_next:${user.id}`, `poster_activity_rebind_v1:${user.id}`]]);
      await query('DELETE FROM "user" WHERE id = $1', [user.id]);
    }
  } catch (error) { failures.push(`Fixture cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  await closeAccountLocks();
  await closeDb();
  await fs.rm(cache, { recursive: true, force: true });
  await saveReport();
}
console.log(`${results.length} requests completed; ${failures.length} failed checks. Reports: ${output}`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exitCode = 1;
await logger.flush();
restoreConsoleLogging();
