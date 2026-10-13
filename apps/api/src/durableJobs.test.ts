import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { query, queryOne, initDb, closeDb, getPool } from "./db";
import { admitJobs, claimJobs, registerWorker, submissionFingerprint, attemptContext, heartbeat, recoverJobs, retryGenerationJob, failAttempt, beginAccountDeletion, checkAttempt, type PreparedJob } from "./durableJobs";
import { imageAttemptContext } from "./jobContext";
import { registerStagedRecord, publishAttempt, recoverPublication, backfillPosterIndex, cleanupImageStorage } from "./publication";
import { createLocalStore, posterStore, rawPosterStore, resetPosterStore } from "./storage";
import { ELIGIBILITY_VERSION } from "./participation";
import { reservePosterQuota, getPosterQuota, withPosterQuota } from "./posterQuota";
import { OpenRouterError } from "./openrouter";
const users: string[] = [];
const workers: string[] = [];
let root: string;
const previous = { ...process.env };
before(async () => {
    process.env.OPENROUTER_IMAGE_MODEL = "test/model";
    process.env.TERMS_VERSION = "queue-test";
    process.env.AI_CONSENT_VERSION = "queue-test";
    process.env.TERMS_ROUTE = "/terms";
    process.env.PRIVACY_ROUTE = "/privacy";
    await initDb();
    root = await mkdtemp(path.join(os.tmpdir(), "durable-images-"));
    resetPosterStore(createLocalStore(root));
    process.env.POSTER_INDEX_ENABLED = "true";
});
after(async () => {
    await query('DELETE FROM "user" WHERE id=ANY($1::text[])', [users]);
    await query('DELETE FROM image_workers WHERE id=ANY($1::text[])', [workers]);
    await query('DELETE FROM image_storage_attempts WHERE user_id=ANY($1::text[])', [users]);
    await query('DELETE FROM image_cleanup WHERE user_id=ANY($1::text[])', [users]);
    await closeDb();
    resetPosterStore();
    await rm(root, { recursive: true, force: true });
    for (const k of ["TERMS_VERSION", "AI_CONSENT_VERSION", "TERMS_ROUTE", "PRIVACY_ROUTE", "POSTER_INDEX_ENABLED", "OPENROUTER_IMAGE_MODEL"])
        if (previous[k] === undefined)
            delete process.env[k];
        else
            process.env[k] = previous[k];
});
async function user(limits: any = {}) {
    const id = `durable-test-${randomUUID()}`;
    users.push(id);
    await query('INSERT INTO "user"(id,name,email,"emailVerified",image_limits) VALUES($1,$1,$2,true,$3)', [id, `${id}@example.com`, limits]);
    await query('UPDATE "user" SET beta_status=\'admitted\' WHERE id=$1', [id]);
    for (const kind of ["eligibility", "terms", "ai"])
        await query('INSERT INTO participation_events(user_id,kind,version,accepted) VALUES($1,$2,$3,true)', [id, kind, kind === "eligibility" ? ELIGIBILITY_VERSION : "queue-test"]);
    return id;
}
function prepared(n = 1): PreparedJob[] { return Array.from({ length: n }, () => ({ id: randomUUID(), work: { kind: "variant", body: { posterId: "20260101T000000Z-aaaa" } }, details: { title: "Test", model: "test/model", variants: 1, activityId: 1 } })); }
async function worker() { const id = `test-worker-${randomUUID()}`; workers.push(id); await registerWorker(id); return id; }
async function job(u: string) { await admitJobs(u, randomUUID(), "hash", prepared()); return (await claimJobs(await worker(), 1))[0]; }
async function expire(id: string) { await query("UPDATE image_attempts SET lease_until=now()-interval '1 second' WHERE id=$1", [id]); }
test("atomic whole-batch admission and canonical durable deduplication", async () => {
    const u = await user();
    const p = prepared(10);
    const sid = randomUUID();
    const fp = submissionFingerprint({ b: 2, a: { d: 4, c: 3 } });
    assert.equal(fp, submissionFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
    const results = await Promise.all([admitJobs(u, sid, fp, p), admitJobs(u, sid, fp, p)]);
    assert.deepEqual(results[0].map(j => j.id), results[1].map(j => j.id));
    await assert.rejects(admitJobs(u, sid, "different", p), /different input/);
    const competing = await Promise.allSettled([admitJobs(u, randomUUID(), "x", prepared(6)), admitJobs(u, randomUUID(), "y", prepared(6))]);
    assert.equal(competing.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await queryOne<any>("SELECT count(*)::int n FROM image_jobs WHERE user_id=$1", [u]))!.n, 16);
    // Keep subsequent scheduling tests isolated from these queued fixtures.
    await query("UPDATE image_jobs SET state='failed' WHERE user_id=$1", [u]);
});
test("two independent processes claim unique jobs and enforce one shared global ceiling", async () => {
    const u = await user({ active: 8, unfinished: 16 });
    await admitJobs(u, randomUUID(), "x", prepared(16));
    const ids = await Promise.all([worker(), worker()]);
    const run = (id: string) => new Promise<string[]>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `const {claimJobs}=await import('./apps/api/src/durableJobs.ts');const {closeDb}=await import('./apps/api/src/db.ts');console.log(JSON.stringify((await claimJobs(process.env.TEST_WORKER,8,8)).map(j=>j.id)));await closeDb();`], { cwd: path.resolve(import.meta.dirname, "../../.."), env: { ...process.env, DB_MIGRATIONS: "off", TEST_WORKER: id }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        child.stdout.on("data", b => out += b);
        child.stderr.on("data", b => err += b);
        child.on("error", reject);
        child.on("exit", code => {
            if (code)
                reject(new Error(err));
            else
                resolve(JSON.parse(out.trim()));
        });
    });
    const claimed = (await Promise.all(ids.map(run))).flat();
    assert.equal(claimed.length, 8);
    assert.equal(new Set(claimed).size, 8);
    await query("UPDATE image_attempts SET capacity_until=now(),terminal_at=now() WHERE user_id=$1", [u]);
    await query("UPDATE image_jobs SET state='failed' WHERE user_id=$1", [u]);
});
test("128 claims fill global capacity with fair per-user turns and no held connections", async () => {
    const owners = await Promise.all(Array.from({ length: 16 }, () => user()));
    const expected = new Map<string, string[]>();
    for (const u of owners) {
        const batch = prepared(8);
        expected.set(u, batch.map(j => j.id));
        await admitJobs(u, randomUUID(), "x", batch);
    }
    const w = await worker();
    const claimed = [];
    for (let i = 0; i < 8; i++)
        claimed.push(...await claimJobs(w, 128 - claimed.length, 128));
    assert.equal(claimed.length, 128);
    for (const u of owners)
        assert.deepEqual(claimed.filter(j => j.user_id === u).map(j => j.id), expected.get(u));
    assert.equal(new Set(claimed.map(j => j.user_id)).size, 16);
    assert.equal((await claimJobs(w, 1, 128)).length, 0);
    const pool = await getPool();
    assert.equal(pool.totalCount, pool.idleCount, "waiting on provider work must not pin query connections");
    await query("UPDATE image_attempts SET capacity_until=now(),terminal_at=now() WHERE user_id=ANY($1::text[])", [owners]);
    await query("UPDATE image_jobs SET state='failed' WHERE user_id=ANY($1::text[])", [owners]);
});
test("expired pre-dispatch jobs requeue, stale ownership is rejected, draining stops claims", async () => {
    const u = await user();
    const j = await job(u);
    await expire(j.attempt_id);
    await recoverJobs();
    assert.equal((await queryOne<any>("SELECT state FROM image_jobs WHERE id=$1", [j.id]))!.state, "queued");
    await assert.rejects(checkAttempt(j.attempt_id));
    await assert.rejects(heartbeat(j.attempt_id));
    const w = await worker();
    await query("UPDATE image_workers SET draining=true WHERE id=$1", [w]);
    assert.deepEqual(await claimJobs(w, 1), []);
    const next = (await claimJobs(await worker(), 1))[0];
    assert.equal(next.id, j.id);
    assert.notEqual(next.attempt_id, j.attempt_id);
    await failAttempt(next, new Error("preparation failure"));
});
test("unknown paid outcomes release quota while blocking early retry", async () => {
    const u = await user();
    const j = await job(u);
    const ctx = attemptContext(j);
    const q = await reservePosterQuota(u, 1);
    await ctx.quota(q.id);
    await ctx.dispatch(600000);
    await expire(j.attempt_id);
    await recoverJobs();
    const state = await queryOne<any>("SELECT * FROM image_jobs WHERE id=$1", [j.id]);
    assert.equal(state.state, "failed");
    assert.equal(state.failure_reason, "uncertain");
    assert.equal((await getPosterQuota(u)).reserved, 0);
    assert.equal((await getPosterQuota(u)).used, 0);
    assert.equal((await getPosterQuota(u)).remaining, 40);
    await assert.rejects(retryGenerationJob(u, j.id), /still be running/);
    await query("UPDATE image_attempts SET capacity_until=now() WHERE id=$1", [j.attempt_id]);
    await query("UPDATE image_jobs SET retry_allowed_at=now() WHERE id=$1", [j.id]);
    await retryGenerationJob(u, j.id);
    const next = (await claimJobs(await worker(), 1))[0];
    assert.equal(next.id, j.id);
    assert.notEqual(next.attempt_id, j.attempt_id);
    await failAttempt(next, new Error("test end"));
});
test("durable provider failures release reservations for explicit errors and timeouts", async () => {
    for (const explicit of [false, true]) {
        const u = await user();
        const j = await job(u);
        const ctx = attemptContext(j);
        const error = explicit ? new OpenRouterError("provider rejected", 502) : new Error("provider timeout");
        if (error instanceof OpenRouterError) error.upstreamStatus = 400;
        await assert.rejects(imageAttemptContext.run(ctx, () => withPosterQuota(u, 4, async () => {
            await ctx.dispatch(1000);
            throw error;
        })), /provider/);
        await failAttempt(j, error);
        const quota = await getPosterQuota(u);
        assert.equal(quota.used, 0);
        assert.equal(quota.reserved, 0);
        assert.equal(quota.remaining, 40);
        await query("UPDATE image_attempts SET capacity_until=now() WHERE id=$1", [j.attempt_id]);
    }
});
test("explicit 429 retries honor provider hints without reserving active capacity", async () => {
    const u = await user();
    const j = await job(u);
    await attemptContext(j).dispatch(1000);
    const e = new OpenRouterError("busy", 503);
    e.upstreamStatus = 429;
    e.retryAfterMs = 60000;
    await failAttempt(j, e);
    const row = await queryOne<any>("SELECT state,extract(epoch FROM retry_at-now()) delay FROM image_jobs WHERE id=$1", [j.id]);
    assert.equal(row.state, "queued");
    assert.ok(Number(row.delay) > 59);
    assert.equal((await claimJobs(await worker(), 1)).length, 0);
    await query("UPDATE image_jobs SET state='failed' WHERE id=$1", [j.id]);
});
async function stage(j: any, complete = true) {
    const ctx = attemptContext(j);
    const q = await reservePosterQuota(j.user_id, 1);
    await ctx.quota(q.id);
    await ctx.dispatch(1000);
    await ctx.received(1);
    const id = ctx.nextPosterId();
    assert.match(id, /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$/);
    const record = { posterId: id, userId: j.user_id, title: "Saved", activityId: 1, referenceCount: 1, createdAt: new Date().toISOString() };
    await imageAttemptContext.run(ctx, async () => {
        await registerStagedRecord(record);
        await posterStore().put(j.user_id, `${id}.png`, Buffer.from("image"), "image/png");
        await posterStore().put(j.user_id, `${id}.json`, Buffer.from(JSON.stringify(record)), "application/json");
        if (complete)
            await posterStore().put(j.user_id, `${id}.ref-1.png`, Buffer.from("reference"), "image/png");
    });
    return id;
}
test("private uploads become visible only after complete atomic publication; recovery does not regenerate", async () => {
    const u = await user();
    const j = await job(u);
    const id = await stage(j);
    assert.equal((await getPosterQuota(u)).used, 0);
    assert.equal((await getPosterQuota(u)).reserved, 1);
    assert.equal(await posterStore().get(u, `${id}.png`), null);
    assert.deepEqual(await posterStore().listJsonNames(u), []);
    await expire(j.attempt_id);
    await recoverJobs();
    assert.equal((await queryOne<any>("SELECT state FROM image_jobs WHERE id=$1", [j.id]))!.state, "completed");
    assert.equal((await posterStore().get(u, `${id}.png`))!.toString(), "image");
    assert.equal((await getPosterQuota(u)).used, 1);
    await assert.rejects(attemptContext(j).check());
    await query("UPDATE image_storage_attempts SET created_at=now()-interval '25 hours' WHERE attempt_id=$1", [j.attempt_id]);
    await cleanupImageStorage();
    assert.ok(await posterStore().get(u, `${id}.png`), "committed output must never expire with staging cleanup");
});
test("partial uploads never publish, stale late uploads stay private and are swept", async () => {
    const u = await user();
    const j = await job(u);
    const id = await stage(j, false);
    await expire(j.attempt_id);
    await recoverJobs();
    assert.equal((await queryOne<any>("SELECT failure_reason FROM image_jobs WHERE id=$1", [j.id]))!.failure_reason, "incomplete");
    assert.equal((await getPosterQuota(u)).used, 0);
    assert.equal((await getPosterQuota(u)).reserved, 0);
    assert.equal((await getPosterQuota(u)).remaining, 40);
    await rawPosterStore().put(u, `_attempts/${j.attempt_id}/${id}.ref-1.png`, Buffer.from("late"), "image/png");
    assert.equal(await posterStore().get(u, `${id}.png`), null);
    await query("UPDATE image_storage_attempts SET created_at=now()-interval '25 hours' WHERE attempt_id=$1", [j.attempt_id]);
    await cleanupImageStorage();
    assert.equal(await rawPosterStore().get(u, `_attempts/${j.attempt_id}/${id}.png`), null);
});
test("deletion coordinates with claims and fences publication, tombstone removes late objects", async () => {
    const u = await user();
    const j = await job(u);
    await assert.rejects(beginAccountDeletion(u), /in progress/);
    await failAttempt(j, new Error("test end"));
    await beginAccountDeletion(u);
    await assert.rejects(admitJobs(u, randomUUID(), "x", prepared()), /unavailable/);
    await assert.rejects(publishAttempt(j.attempt_id));
    await rawPosterStore().put(u, `_attempts/${j.attempt_id}/late.png`, Buffer.from("late"), "image/png");
    await cleanupImageStorage();
    assert.equal(await rawPosterStore().get(u, `_attempts/${j.attempt_id}/late.png`), null);
});
test("legacy backfill preserves IDs and indexed metadata mutations", async () => {
    const u = await user();
    const id = "20260101T000000Z-aaaa";
    await rawPosterStore().put(u, `${id}.json`, Buffer.from(JSON.stringify({ posterId: id, activityId: 1, title: "Legacy" })), "application/json");
    await rawPosterStore().put(u, `${id}.png`, Buffer.from("legacy image"), "image/png");
    await backfillPosterIndex(u);
    assert.deepEqual(await posterStore().listJsonNames(u), [`${id}.json`]);
    await posterStore().put(u, `${id}.json`, Buffer.from(JSON.stringify({ posterId: id, activityId: 1, title: "Changed" })), "application/json");
    assert.equal(JSON.parse((await posterStore().get(u, `${id}.json`))!.toString()).title, "Changed");
    await posterStore().removeByPosterId(u, id);
    assert.equal(await posterStore().get(u, `${id}.png`), null);
});
test("the full variant provider/staging path does not hold database connections", async (t) => {
    const { buildInitialPoster } = await import("./planner");
    const { variantPoster } = await import("./poster");
    const { default: sharp } = await import("sharp");
    const u = await user();
    const sourceId = "20260101T000000Z-aabb";
    const spec = buildInitialPoster({ activity: {}, title: "Ride", subtitle: "", stats: [], style: { id: "test", label: "Test", prompt: "Test style" }, aspectRatio: "3:4", geography: [], pois: [], grounding: [{ index: 1, role: "route-only", legend: "route" }] }).spec;
    const png = await sharp({ create: { width: 100, height: 150, channels: 3, background: "white" } }).png().toBuffer();
    const record = { posterId: sourceId, userId: u, activityId: 1, title: "Ride", spec, prompt: "Saved brief", model: "test/model", referenceCount: 1, aspectRatio: "3:4" };
    await rawPosterStore().put(u, `${sourceId}.json`, Buffer.from(JSON.stringify(record)), "application/json");
    await rawPosterStore().put(u, `${sourceId}.png`, png, "image/png");
    await rawPosterStore().put(u, `${sourceId}.ref-1.png`, png, "image/png");
    await backfillPosterIndex(u);
    const priorKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (input: any) => {
        if (String(input).endsWith("/images/models"))
            return Response.json({ data: [{ id: "test/model", max_input_references: 3, max_images: 1 }] });
        assert.equal(String(input), "https://openrouter.ai/api/v1/images");
        calls++;
        const pool = await getPool();
        assert.equal(pool.totalCount, pool.idleCount);
        await new Promise(r => setTimeout(r, 20));
        return Response.json({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }] });
    });
    const j = await job(u);
    j.work = { kind: "variant", body: { posterId: sourceId, model: "test/model" } };
    try {
        const ctx = attemptContext(j);
        const results = await imageAttemptContext.run(ctx, () => variantPoster(u, { posterId: sourceId, model: "test/model" }));
        assert.equal(calls, 1);
        assert.equal(await posterStore().get(u, `${results[0].posterId}.png`), null);
        await imageAttemptContext.run(ctx, () => publishAttempt(ctx.id));
        assert.ok(await posterStore().get(u, `${results[0].posterId}.png`));
        assert.equal((await getPosterQuota(u)).used, 1);
    }
    finally {
        if (priorKey === undefined)
            delete process.env.OPENROUTER_API_KEY;
        else
            process.env.OPENROUTER_API_KEY = priorKey;
    }
});
test("a late upload after ownership loss and account deletion cannot publish or survive cleanup", async () => {
    const u = await user();
    const j = await job(u);
    const ctx = attemptContext(j);
    await ctx.dispatch(1000);
    await ctx.received(1);
    const id = ctx.nextPosterId();
    assert.match(id, /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$/);
    await imageAttemptContext.run(ctx, () => registerStagedRecord({ posterId: id, referenceCount: 0, title: "Late", activityId: 1 }));
    const base = rawPosterStore();
    let started!: () => void, release!: () => void;
    const began = new Promise<void>(r => started = r);
    const gate = new Promise<void>(r => release = r);
    resetPosterStore({ ...base, async put(user, name, bytes, type) { started(); await gate; await base.put(user, name, bytes, type); } });
    try {
        const pending = imageAttemptContext.run(ctx, () => posterStore().put(u, `${id}.png`, Buffer.from("late output"), "image/png"));
        const outcome = pending.then(() => null, error => error);
        await began;
        assert.equal((await getPool()).totalCount, (await getPool()).idleCount);
        await expire(j.attempt_id);
        await recoverJobs();
        await assert.rejects(beginAccountDeletion(u), /in progress/);
        await query("UPDATE image_objects SET upload_until=now()-interval '1 second' WHERE attempt_id=$1", [j.attempt_id]);
        await beginAccountDeletion(u);
        await query('DELETE FROM "user" WHERE id=$1', [u]);
        release();
        assert.ok(await outcome);
        assert.equal(await posterStore().get(u, `${id}.png`), null);
        await cleanupImageStorage();
        assert.equal(await base.get(u, `_attempts/${j.attempt_id}/${id}.png`), null);
    }
    finally {
        release();
        resetPosterStore(base);
    }
});
test("128 simultaneous two-image requests with realistic buffers and slow uploads leave the pool idle", async (t) => {
    const { createImage } = await import("./openrouter");
    const { withPosterQuota } = await import("./posterQuota");
    const { default: sharp } = await import("sharp");
    const { randomBytes } = await import("node:crypto");
    const png = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    const owners = await Promise.all(Array.from({ length: 16 }, () => user()));
    for (const u of owners)
        await admitJobs(u, randomUUID(), "load", prepared(8));
    const w = await worker();
    const jobs = [];
    while (jobs.length < 128)
        jobs.push(...await claimJobs(w, 128 - jobs.length));
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    let started = 0;
    const base = rawPosterStore();
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    resetPosterStore({ ...base, async put(u, n, b, type) { await new Promise(r => setTimeout(r, 10)); await base.put(u, n, b, type); } });
    t.mock.method(globalThis, "fetch", async () => {
        started++;
        await gate;
        return Response.json({ data: [0, 1].map(() => ({ b64_json: png.toString("base64"), media_type: "image/png" })) });
    });
    const tasks = jobs.map(j => {
        const ctx = attemptContext(j);
        return imageAttemptContext.run(ctx, async () => {
            const result = await withPosterQuota(j.user_id, 2, () => createImage({ prompt: "Load test", aspectRatio: "3:4", model: "test/model", n: 2, references: [`data:image/png;base64,${png.toString("base64")}`], user: j.user_id }));
            for (const image of result.images) {
                const id = ctx.nextPosterId();
                assert.match(id, /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]+$/);
                const record = { posterId: id, title: "Load", activityId: 1, referenceCount: 1 };
                await registerStagedRecord(record);
                await posterStore().put(j.user_id, `${id}.png`, Buffer.from(image.b64, "base64"), "image/png");
                await posterStore().put(j.user_id, `${id}.ref-1.png`, png, "image/png");
                await posterStore().put(j.user_id, `${id}.json`, Buffer.from(JSON.stringify(record)), "application/json");
            }
            await publishAttempt(j.attempt_id);
        });
    });
    const completion = Promise.allSettled(tasks);
    try {
        const deadline = Date.now() + 15000;
        while (started < 128 && Date.now() < deadline)
            await new Promise(r => setTimeout(r, 10));
        assert.equal(started, 128);
        const pool = await getPool();
        assert.equal(pool.totalCount, pool.idleCount);
        release();
        const outcomes = await completion;
        const failures = outcomes.filter(r => r.status === "rejected");
        assert.deepEqual(failures, []);
        assert.equal((await queryOne<any>("SELECT count(*)::int n FROM poster_publications WHERE user_id=ANY($1::text[])", [owners]))!.n, 256);
        assert.equal(pool.totalCount, pool.idleCount);
        console.log(`Load fixture: 128 requests, 256 images, ${png.length} reference/output bytes each, RSS ${Math.round(process.memoryUsage().rss / 1048576)} MiB`);
    }
    finally {
        release();
        await completion;
        resetPosterStore(base);
        if (key === undefined)
            delete process.env.OPENROUTER_API_KEY;
        else
            process.env.OPENROUTER_API_KEY = key;
    }
});
test("local references support separate processes without R2", async () => {
    const { uploadReferences, resolveReferences } = await import("./referenceUploads");
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
    const store = createLocalStore(path.join(root, "references"));
    const u = await user();
    const batch = await uploadReferences(u, [`data:image/png;base64,${png.toString("base64")}`], store);
    const images = await resolveReferences(u, batch.referenceBatchId, true, store);
    assert.equal(images[0].url, `data:image/png;base64,${png.toString("base64")}`);
    assert.deepEqual(images[0].bytes, png);
    await assert.rejects(resolveReferences(await user(), batch.referenceBatchId, true, store), /not found/);
});
test("bootstrap indexes newly claimed legacy files even after an empty startup backfill", async () => {
    const { writeFile } = await import("node:fs/promises");
    const u = await user();
    const id = "20260101T000000Z-aaccee";
    await backfillPosterIndex(u);
    await writeFile(path.join(root, `${id}.json`), JSON.stringify({ posterId: id, title: "Bootstrap", activityId: 1 }));
    await writeFile(path.join(root, `${id}.png`), Buffer.from("old image"));
    await posterStore().migrateUnscopedToUser(u);
    assert.deepEqual(await posterStore().listJsonNames(u), [`${id}.json`]);
    assert.equal((await posterStore().get(u, `${id}.png`))!.toString(), "old image");
});

test("optional thumbnail failure does not prevent complete image publication", async () => {
    const u=await user();const j=await job(u);const id=await stage(j);
    const ctx=attemptContext(j);const base=rawPosterStore();
    resetPosterStore({...base,async put(user,name,bytes,type){if(name.endsWith(".thumb.webp"))throw new Error("Thumbnail storage unavailable");await base.put(user,name,bytes,type);}});
    try {
        await imageAttemptContext.run(ctx,()=>assert.rejects(posterStore().put(u,`${id}.thumb.webp`,Buffer.from("thumbnail"),"image/webp")));
        await publishAttempt(j.attempt_id);
        assert.ok(await posterStore().get(u,`${id}.png`));
    }finally{resetPosterStore(base);}
});
