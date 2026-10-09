import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { Hono } from "hono";
import { closeAccountLocks, withAccountAccess } from "./accountLifecycle";
import { createRequireUser } from "./auth";
import { providerQueue } from "./requestQueue";
import { getActivity } from "./activities";
import { closeDb, initDb, query } from "./db";
import { GenerationJobQueue, type JobInput } from "./generationJobs";
import { INSUFFICIENT_CREDIT_MESSAGE, OpenRouterError } from "./openrouter";
import { buildInitialPoster, type PlannerInput } from "./planner";
import { generatePoster, modifyPoster, variantPoster } from "./poster";
import { getPosterQuota } from "./posterQuota";
import { posterStore, resetPosterStore } from "./storage";

test("queued batches and direct generation/refinement/variants release quota and capacity on insufficient credit, without automatic resumption", async t => {
  const owner = `credit-test-${randomUUID()}`;
  const activityId = 8_000_000_000_000 + randomInt(1_000_000_000);
  const envNames = ["OPENROUTER_API_KEY", "OPENROUTER_IMAGE_MODEL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"];
  const previous = envNames.map(name => process.env[name]);
  for (const name of envNames) delete process.env[name];
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_IMAGE_MODEL = "test/credit-image";
  resetPosterStore();
  const store = posterStore();
  t.after(async () => {
    try {
      for (const name of await store.listJsonNames(owner)) await store.removeByPosterId(owner, name.slice(0, -5));
      await query("DELETE FROM activities WHERE user_id = $1", [owner]);
      await query('DELETE FROM "user" WHERE id = $1', [owner]);
      await closeAccountLocks();
      await closeDb();
    } finally {
      envNames.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
      resetPosterStore();
    }
  });
  await initDb();
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [owner, `${owner}@example.com`]);
  await query(`INSERT INTO activities (id, user_id, name, type, sport_type, start_date, distance)
    VALUES ($1, $2, 'Credit test', 'Ride', 'Ride', '2026-10-08', 1000)`, [activityId, owner]);
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
  const reference = `data:image/png;base64,${png.toString("base64")}`;
  let creditAvailable = true;
  let imageCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    const endpoint = String(url);
    if (endpoint === "https://openrouter.ai/api/v1/images/models") {
      return new Response(JSON.stringify({ data: [{ id: "test/credit-image", name: "Credit test", max_input_references: 3, max_images: 1 }] }));
    }
    if (endpoint.endsWith("/endpoints")) return new Response(JSON.stringify({ data: { max_input_references: 3 } }));
    assert.equal(endpoint, "https://openrouter.ai/api/v1/images", "all provider calls are intercepted");
    imageCalls++;
    return creditAvailable
      ? new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }], usage: { cost: 0.01 } }))
      : new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }), { status: 402 });
  });
  const plan: PlannerInput = {
    activity: { name: "Credit test", sportType: "Ride" }, title: "Credit test", subtitle: "", stats: [],
    style: { id: "test", label: "Test", prompt: "Minimal map poster" }, aspectRatio: "3:4", geography: [], pois: [],
    grounding: [{ index: 1, role: "schematic", legend: "route" }], referenceBatchId: "test-refs",
  };
  const planned = buildInitialPoster(plan);
  const body = { activityId, spec: planned.spec, references: [reference], model: "test/credit-image", variants: 1, styleId: "test", paletteId: "auto" };
  const [source] = await generatePoster(owner, body);
  assert.equal((await getPosterQuota(owner)).used, 1);
  creditAvailable = false;
  for (const direct of [
    () => generatePoster(owner, body),
    () => modifyPoster(owner, { posterId: source.posterId, request: "Use blue", variants: 1 }),
    () => variantPoster(owner, { posterId: source.posterId }),
  ]) {
    const before = imageCalls;
    await assert.rejects(direct(), error => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.status, 503);
      assert.equal(error.providerCode, "insufficient_credit");
      assert.equal(error.message, INSUFFICIENT_CREDIT_MESSAGE);
      return true;
    });
    assert.equal(imageCalls, before + 1, "direct failures do not retry automatically");
    const quota = await getPosterQuota(owner);
    assert.equal(quota.used, 1);
    assert.equal(quota.reserved, 0);
  }
  const queue = new GenerationJobQueue({
    getActivity, resolveReferences: async () => [{ url: reference, mime: "image/png" }] as any,
    maxImageOutputs: async () => 1, prepare: buildInitialPoster,
    generate: (user, input) => generatePoster(user, { ...input, referenceBatchId: undefined, references: [reference] }),
  });
  const input: JobInput = { plan, generate: { ...body, referenceBatchId: "test-refs" } };
  const jobs = await queue.submit(owner, { submissionId: "credit-batch", jobs: Array.from({ length: 8 }, () => input) });
  const beforeBatch = imageCalls;
  await Promise.all(queue.dispatch());
  assert.equal(imageCalls, beforeBatch + 8, "each admitted job attempts once and fails without automatic retry");
  assert.ok(queue.list(owner).every(job => job.state === "failed" && job.error === INSUFFICIENT_CREDIT_MESSAGE && job.imageAttempt === 1));
  assert.equal(queue.dispatch().length, 0);
  assert.equal((await getPosterQuota(owner)).reserved, 0);
  assert.equal((await getPosterQuota(owner)).used, 1);
  creditAvailable = true;
  assert.equal(queue.dispatch().length, 0, "refilling credit does not resume failed jobs");
  // Calendar changes do not move a failed job back to queued either.
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 60 * 24 * 60 * 60 * 1000);
  assert.equal(queue.dispatch().length, 0, "calendar reset does not resume failed jobs");
  t.mock.restoreAll();
  // Reinstall the provider mock removed by restoreAll; avoid any external request.
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/images");
    imageCalls++;
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  queue.retry(owner, jobs[0].id);
  await Promise.all(queue.dispatch());
  assert.equal(queue.list(owner).filter(job => job.state === "failed").length, 7);
  assert.equal((await getPosterQuota(owner)).used, 2);
  assert.equal((await getPosterQuota(owner)).reserved, 0);
  assert.equal((await queue.submit(owner, { submissionId: "capacity-restored", jobs: Array.from({ length: 8 }, () => input) })).length, 8,
    "failed jobs and manual retry completion released waiting capacity");
  await Promise.all(queue.dispatch());

  const releases: (() => void)[] = [];
  const busy = Array.from({ length: 8 }, () => providerQueue("image").run(
    () => new Promise<void>(resolve => releases.push(resolve)), null, owner));
  await Promise.resolve();
  const app = new Hono();
  app.use("/api/*", createRequireUser(async () => ({ id: owner, email: `${owner}@example.com`, name: owner }), async () => {}));
  app.post("/api/poster/variant", c => c.json({ ok: true }));
  const request = app.request("/api/poster/variant", { method: "POST" });
  await new Promise(resolve => setImmediate(resolve));
  await withAccountAccess(owner, true, async () => {});
  // Exclusive access succeeded: the image request waiting for a slot does
  // not hold an account lock, avoiding inversion against gallery workers.
  releases.forEach(release => release());
  await Promise.all(busy);
  assert.equal((await request).status, 200);
});
