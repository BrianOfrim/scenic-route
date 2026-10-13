import { logger } from "./logger";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { accountContext, AccountUnavailableError } from "./accountLifecycle";
import { query, queryOne, withTransaction, type SqlClient } from "./db";
import { GenerationJobQueue, type JobInput } from "./generationJobsMemory";
import { parseImageLimits } from "./imageLimits";
import { imageAttemptContext, type ImageAttemptContext } from "./jobContext";
import { resolveImageModel, OpenRouterError } from "./openrouter";
import { generatePoster, modifyPoster, variantPoster } from "./poster";
import { participationStatus, assertParticipation } from "./participation";
import { RequestQueue, RequestQueueError } from "./requestQueue";
import { publishAttempt, recoverPublication, cleanupImageStorage } from "./publication";
export class JobConflictError extends Error {
    status = 409;
}
export class OwnershipLostError extends Error {
}
export type PreparedJob = ReturnType<GenerationJobQueue["prepared"]>[number];
export type ClaimedJob = PreparedJob & {
    user_id: string;
    attempt_id: string;
    execution_token: string;
    attempt_no: number;
    retry_count: number;
};
/** Sort object keys recursively so retries do not depend on JSON key order. */
export function submissionFingerprint(value: unknown): string {
    const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])])) : v;
    return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
async function scheduler(client: SqlClient) { await client.query("SELECT id FROM image_scheduler WHERE id=1 FOR UPDATE"); }
async function owner(userId: string, client: SqlClient) {
    const user = await queryOne<any>('SELECT image_limits, image_deleting, beta_status FROM "user" WHERE id=$1 FOR UPDATE', [userId], client);
    if (!user || user.image_deleting)
        throw new AccountUnavailableError("Account unavailable for generation.", 409);
    if (user.beta_status !== "admitted")
        throw new AccountUnavailableError("Your account is on the public beta waitlist.", 403);
    return parseImageLimits(user.image_limits);
}
async function room(userId: string, count: number, limit: number | null, client: SqlClient) {
    const n = await queryOne<{
        n: number;
    }>("SELECT count(*)::int n FROM image_jobs WHERE user_id=$1 AND state IN ('queued','generating')", [userId], client);
    if (limit !== null && n!.n + count > limit)
        throw new RequestQueueError(`You can have at most ${limit} unfinished image-generation jobs. Please wait for existing work to finish.`);
}
function publicJob(j: any) {
    return { id: j.id, state: j.state, ...j.details, error: j.error, imageAttempt: j.state === "queued" ? j.retry_count : j.retry_count + 1,
        failureReason: j.failure_reason || undefined, retryAllowedAt: j.retry_allowed_at?.toISOString(),
        resultPosterIds: j.result_ids, createdAt: j.created_at.toISOString() };
}
async function submission(userId: string, id: string, fingerprint: string, client?: SqlClient) {
    const existing = await queryOne<any>("SELECT fingerprint FROM image_submissions WHERE user_id=$1 AND submission_id=$2", [userId, id], client);
    if (!existing)
        return null;
    if (existing.fingerprint !== fingerprint)
        throw new JobConflictError("This submission ID was already used with different input.");
    return (await query<any>("SELECT * FROM image_jobs WHERE user_id=$1 AND submission_id=$2 ORDER BY queue_sequence", [userId, id], client)).map(publicJob);
}
export async function admitJobs(userId: string, id: string, fingerprint: string, prepared: PreparedJob[]) {
    return withTransaction(async (client) => {
        await scheduler(client);
        const limits = await owner(userId, client);
        const existing = await submission(userId, id, fingerprint, client);
        if (existing)
            return existing;
        const enabled = await queryOne<{
            enabled: boolean;
        }>("SELECT enabled FROM image_scheduler WHERE id=1", [], client);
        if (!enabled!.enabled)
            throw new RequestQueueError("Image submissions are paused for maintenance.");
        const selections = new Set(prepared.filter(j => j.work.kind === "generate").map(j => JSON.stringify([j.details.styleId, j.details.paletteId || "auto"])));
        if (limits.selections !== null && selections.size > limits.selections)
            throw new Error("Batch exceeds the account selection limit");
        await room(userId, prepared.length, limits.unfinished, client);
        await client.query("INSERT INTO image_owners(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
        await client.query("INSERT INTO image_submissions(user_id,submission_id,fingerprint) VALUES($1,$2,$3)", [userId, id, fingerprint]);
        for (const j of prepared)
            await client.query("INSERT INTO image_jobs(id,user_id,submission_id,work,details) VALUES($1,$2,$3,$4,$5)", [j.id, userId, id, j.work, j.details]);
        return (await query<any>("SELECT * FROM image_jobs WHERE user_id=$1 AND submission_id=$2 ORDER BY queue_sequence", [userId, id], client)).map(publicJob);
    });
}
export async function submitGenerationJobs(userId: string, body: {
    submissionId: string;
    jobs: JobInput[];
}) {
    if (!body || !/^[\w-]{1,100}$/.test(body.submissionId))
        throw new Error("submissionId is required");
    const fp = submissionFingerprint({ kind: "generate", body });
    const existing = await submission(userId, body.submissionId, fp);
    if (existing)
        return existing;
    const adapter = new GenerationJobQueue(undefined, new RequestQueue(128, Infinity, 240000, 8, 16));
    const jobs = await adapter.submit(userId, body);
    const prepared = adapter.prepared(jobs.map(j => j.id));
    for (const j of prepared)
        if (j.work.kind === "generate") {
            j.work.input.generate.model = resolveImageModel(j.work.input.generate.model);
            j.details.model = j.work.input.generate.model;
            // Hosted references are resolved at execution; inline image bytes never enter job rows.
            delete j.work.input.generate.references;
            delete j.work.input.generate.persistReferences;
        }
    return admitJobs(userId, body.submissionId, fp, prepared);
}
export async function submitSavedGenerationJob(userId: string, kind: "modify" | "variant", body: Parameters<GenerationJobQueue["submitSaved"]>[2]) {
    if (!body || !/^[\w-]{1,100}$/.test(body.submissionId))
        throw new Error("submissionId is required");
    const fp = submissionFingerprint({ kind, body });
    const existing = await submission(userId, body.submissionId, fp);
    if (existing)
        return existing;
    const adapter = new GenerationJobQueue(undefined, new RequestQueue(128, Infinity, 240000, 8, 16));
    const jobs = await adapter.submitSaved(userId, kind, body);
    return admitJobs(userId, body.submissionId, fp, adapter.prepared(jobs.map(j => j.id)));
}
export async function listGenerationJobs(userId: string) {
    return (await query<any>("SELECT * FROM image_jobs WHERE user_id=$1 AND NOT dismissed AND state <> 'completed' AND (state IN ('queued','generating') OR updated_at > now()-interval '24 hours') ORDER BY queue_sequence", [userId])).map(publicJob);
}
export async function retryGenerationJob(userId: string, id: string) {
    return withTransaction(async (client) => {
        await scheduler(client);
        const enabled = await queryOne<{
            enabled: boolean;
        }>("SELECT enabled FROM image_scheduler WHERE id=1", [], client);
        if (!enabled!.enabled)
            throw new RequestQueueError("Image submissions are paused for maintenance.");
        const limits = await owner(userId, client);
        const j = await queryOne<any>("SELECT *, retry_allowed_at > now() blocked FROM image_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId], client);
        if (!j || j.state !== "failed")
            throw new Error("failed job not found");
        if (j.blocked)
            throw new JobConflictError("The previous request may still be running. Wait until the displayed retry time.");
        await room(userId, 1, limits.unfinished, client);
        await client.query("UPDATE image_jobs SET state='queued',retry_count=0,error=null,failure_reason=null,retry_at=now(),retry_allowed_at=null,dismissed=false,updated_at=now() WHERE id=$1", [id]);
        await client.query("UPDATE image_submissions SET terminal_at=null WHERE user_id=$1 AND submission_id=$2", [userId, j.submission_id]);
        return (await query<any>("SELECT * FROM image_jobs WHERE id=$1", [id], client)).map(publicJob);
    });
}
export async function dismissGenerationJob(userId: string, id: string) { await query("UPDATE image_jobs SET dismissed=true WHERE id=$1 AND user_id=$2 AND state='failed'", [id, userId]); }
export async function removeUserGenerationJobs(userId: string) { await query("DELETE FROM image_jobs WHERE user_id=$1", [userId]); }
export async function registerWorker(id: string, role = "worker") {
    await query("INSERT INTO image_workers(id,role) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()", [id, role]);
}
export async function claimJobs(workerId: string, count: number, globalLimit?: number): Promise<ClaimedJob[]> {
    return withTransaction(async (client) => {
        await scheduler(client);
        const worker = await queryOne<any>("UPDATE image_workers SET heartbeat_at=now() WHERE id=$1 RETURNING draining", [workerId], client);
        if (!worker || worker.draining)
            return [];
        const settings = await queryOne<{
            global_limit: number;
        }>("SELECT global_limit FROM image_scheduler WHERE id=1", [], client);
        const ceiling = Math.min(settings!.global_limit, globalLimit ?? settings!.global_limit);
        const active = await queryOne<{
            n: number;
        }>("SELECT count(*)::int n FROM image_attempts WHERE capacity_until > now()", [], client);
        const result: ClaimedJob[] = [];
        for (let i = 0; i < Math.min(count, ceiling - active!.n, 16); i++) {
            const candidate = await queryOne<any>(`SELECT u.id, u.image_limits FROM image_owners o JOIN "user" u ON u.id=o.user_id
        WHERE NOT u.image_deleting AND u.beta_status='admitted'
        AND EXISTS(SELECT 1 FROM image_jobs j WHERE j.user_id=u.id AND j.state='queued' AND j.payload_version=1 AND j.retry_at<=now())
        AND (u.image_limits->'active'='null'::jsonb OR (SELECT count(*) FROM image_attempts a WHERE a.user_id=u.id AND a.capacity_until>now())
          < COALESCE((u.image_limits->>'active')::int,$1))
        ORDER BY o.last_claim,u.id LIMIT 1 FOR UPDATE OF u,o SKIP LOCKED`, [Number(process.env.OPENROUTER_IMAGE_USER_CONCURRENCY || 8)], client);
            if (!candidate)
                break;
            const j = await queryOne<any>("SELECT * FROM image_jobs WHERE user_id=$1 AND state='queued' AND payload_version=1 AND retry_at<=now() ORDER BY queue_sequence LIMIT 1 FOR UPDATE SKIP LOCKED", [candidate.id], client);
            if (!j)
                continue;
            const token = randomUUID();
            const executionToken = randomUUID();
            await client.query("UPDATE image_owners SET last_claim=nextval('image_claim_order') WHERE user_id=$1", [candidate.id]);
            await client.query("INSERT INTO image_attempts(id,job_id,user_id,worker_id,execution_token,lease_until,capacity_until) VALUES($1,$2,$3,$4,$5,now()+interval '90 seconds',now()+interval '90 seconds')", [token, j.id, j.user_id, workerId, executionToken]);
            await client.query("UPDATE image_jobs SET state='generating',attempt_id=$2,attempt_no=attempt_no+1,error=null,updated_at=now() WHERE id=$1", [j.id, token]);
            result.push({ id: j.id, work: j.work, details: j.details, user_id: j.user_id, attempt_id: token, execution_token: executionToken, attempt_no: j.attempt_no + 1, retry_count: j.retry_count });
        }
        return result;
    });
}
export async function checkAttempt(id: string, client?: SqlClient, lock = false, token?: string) {
    token ??= imageAttemptContext.getStore()?.token;
    const a = await queryOne<any>(`SELECT a.*,j.state,j.attempt_id,j.details FROM image_attempts a JOIN image_jobs j ON j.id=a.job_id JOIN "user" u ON u.id=j.user_id
    WHERE a.id=$1 AND j.attempt_id=a.id AND j.state='generating' AND a.terminal_at IS NULL AND a.lease_until>now() AND NOT u.image_deleting AND ($2::uuid IS NULL OR a.execution_token=$2) ${lock ? "FOR UPDATE OF j,a" : ""}`, [id, token || null], client);
    if (!a)
        throw new OwnershipLostError("Image attempt ownership was lost.");
    return a;
}
export async function heartbeat(id: string, token?: string) {
    const rows = await query(`UPDATE image_attempts a SET lease_until=now()+interval '90 seconds',
    capacity_until=GREATEST(capacity_until,now()+interval '90 seconds') FROM image_jobs j
    WHERE a.id=$1 AND j.id=a.job_id AND j.attempt_id=a.id AND j.state='generating' AND a.terminal_at IS NULL AND a.lease_until>now() AND ($2::uuid IS NULL OR a.execution_token=$2) RETURNING a.id`, [id, token || null]);
    if (!rows.length)
        throw new OwnershipLostError("Image lease expired.");
}
export function attemptContext(j: ClaimedJob): ImageAttemptContext {
    let index = 0;
    let outputStamp: string | undefined;
    return { id: j.attempt_id, token: j.execution_token, jobId: j.id, userId: j.user_id,
        nextPosterId: () => { if (!outputStamp)
            throw new Error("Output IDs require a durable provider receipt"); return `${outputStamp}-${createHash("sha256").update(`${j.attempt_id}:${index++}`).digest("hex").slice(0, 24)}`; },
        check: async () => { const a = await checkAttempt(j.attempt_id, undefined, false, j.execution_token); outputStamp ??= a.output_stamp || undefined; },
        quota: async (id) => { await withTransaction(async (client) => { await checkAttempt(j.attempt_id, client, true, j.execution_token); await client.query("UPDATE image_attempts SET quota_id=$2 WHERE id=$1", [j.attempt_id, id]); }); },
        dispatch: async (timeoutMs) => {
            await withTransaction(async (client) => {
                const a = await checkAttempt(j.attempt_id, client, true, j.execution_token);
                assertParticipation(await participationStatus(j.user_id, undefined, client), true);
                if (a.dispatched_at)
                    throw new OwnershipLostError("A provider request was already dispatched for this attempt.");
                await client.query("UPDATE image_attempts SET phase='dispatched',dispatched_at=now(),capacity_until=now()+$2*interval '1 millisecond' WHERE id=$1", [j.attempt_id, timeoutMs + 60000]);
            });
        },
        received: async (count) => {
            await withTransaction(async (client) => {
                await checkAttempt(j.attempt_id, client, true, j.execution_token);
                const received = await client.query("UPDATE image_attempts SET phase='received',output_count=$2,output_stamp=COALESCE(output_stamp,to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD\"T\"HH24MISS\"Z\"')) WHERE id=$1 RETURNING output_stamp", [j.attempt_id, count]);
                outputStamp = received.rows[0].output_stamp;
            });
        }
    };
}
async function markSubmissionTerminal(client: SqlClient, userId: string, submissionId: string) {
    await client.query(`UPDATE image_submissions s SET terminal_at=now() WHERE user_id=$1 AND submission_id=$2 AND terminal_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM image_jobs j WHERE j.user_id=s.user_id AND j.submission_id=s.submission_id AND j.state IN ('queued','generating'))`, [userId, submissionId]);
}
export async function failAttempt(j: ClaimedJob, error: unknown) {
    await withTransaction(async (client) => {
        const current = await queryOne<any>("SELECT j.* FROM image_jobs j JOIN image_attempts a ON a.id=j.attempt_id WHERE j.id=$1 AND j.attempt_id=$2 AND j.state='generating' AND a.execution_token=$3 FOR UPDATE OF j", [j.id, j.attempt_id, j.execution_token], client);
        if (!current)
            return;
        const a = await queryOne<any>("SELECT * FROM image_attempts WHERE id=$1 FOR UPDATE", [j.attempt_id], client);
        const explicit = error instanceof OpenRouterError && error.upstreamStatus !== undefined;
        const uncertain = !!a.dispatched_at && a.output_count === null && !explicit;
        const retry = explicit && j.retry_count < 2 && !["insufficient_credit", "in_flight_budget"].includes(error.providerCode || "") && [429, 502, 503, 504].includes(error.upstreamStatus!);
        const delay = retry ? Math.max(error.retryAfterMs || 0, (j.retry_count ? 15000 : 5000) + Math.random() * 2000) : 0;
        const reason = uncertain ? "uncertain" : a.output_count !== null ? "incomplete" : "failed";
        const message = uncertain ? "The paid request may have completed. Check your gallery before retrying; regeneration may incur another charge." : error instanceof Error ? error.message : "Generation failed";
        await client.query("UPDATE image_attempts SET terminal_at=now(),phase=$2,capacity_until=CASE WHEN $3 THEN capacity_until ELSE now() END WHERE id=$1", [a.id, reason, uncertain]);
        if (a.quota_id)
            await client.query("UPDATE poster_generation_usage SET generated=0 WHERE id=$1 AND generated IS NULL", [a.quota_id]);
        await client.query(`UPDATE image_jobs SET state=$2,error=$3,failure_reason=$4,retry_count=retry_count+$5,
      retry_at=now()+$6*interval '1 millisecond',retry_allowed_at=CASE WHEN $7 THEN $8::timestamptz ELSE null END,updated_at=now() WHERE id=$1`, [j.id, retry ? "queued" : "failed", retry ? null : message, retry ? null : reason, retry ? 1 : 0, delay, uncertain, a.capacity_until]);
        await markSubmissionTerminal(client, j.user_id, current.submission_id);
    });
}
export async function recoverJobs() {
    const expired = await query<any>("SELECT a.id FROM image_attempts a JOIN image_jobs j ON j.attempt_id=a.id WHERE j.state='generating' AND a.lease_until<=now() AND a.terminal_at IS NULL LIMIT 32");
    for (const row of expired) {
        // Recover only after acquiring fresh ownership in a short transaction.
        const j = await withTransaction(async (client) => {
            const job = await queryOne<any>("SELECT j.* FROM image_jobs j JOIN image_attempts a ON j.attempt_id=a.id WHERE a.id=$1 AND a.lease_until<=now() AND j.state='generating' FOR UPDATE OF j SKIP LOCKED", [row.id], client);
            if (!job)
                return null;
            const a = await queryOne<any>("SELECT * FROM image_attempts WHERE id=$1 FOR UPDATE SKIP LOCKED", [row.id], client);
            if (!a)
                return null;
            if (!a.dispatched_at) {
                await client.query("UPDATE image_attempts SET terminal_at=now(),phase='abandoned',capacity_until=now() WHERE id=$1", [a.id]);
                if (a.quota_id)
                    await client.query("UPDATE poster_generation_usage SET generated=0 WHERE id=$1 AND generated IS NULL", [a.quota_id]);
                await client.query("UPDATE image_jobs SET state='queued',attempt_id=null,retry_at=now(),updated_at=now() WHERE id=$1", [job.id]);
                return null;
            }
            const executionToken = randomUUID();
            await client.query("UPDATE image_attempts SET lease_until=now()+interval '90 seconds',execution_token=$2 WHERE id=$1", [a.id, executionToken]);
            return { ...job, attempt_id: a.id, execution_token: executionToken } as ClaimedJob;
        });
        if (j) {
            try {
                if (await recoverPublication(j.attempt_id, j.execution_token))
                    continue;
                await failAttempt(j, new Error("Generated output was not completely saved before the worker stopped."));
            }
            catch (error) {
                await failAttempt(j, error);
            }
        }
    }
    await query(`UPDATE image_submissions s SET terminal_at=now() WHERE terminal_at IS NULL AND NOT EXISTS
    (SELECT 1 FROM image_jobs j WHERE j.user_id=s.user_id AND j.submission_id=s.submission_id AND j.state IN ('queued','generating'))`);
    await withTransaction(async (client) => {
        await scheduler(client);
        const old = await query<any>("SELECT user_id,submission_id FROM image_submissions WHERE terminal_at<now()-interval '24 hours' LIMIT 100 FOR UPDATE SKIP LOCKED", [], client);
        for (const s of old) {
            // Never prune attempts still retained for publication/cleanup inspection.
            await client.query("DELETE FROM image_jobs WHERE user_id=$1 AND submission_id=$2 AND updated_at<now()-interval '24 hours' AND state IN ('failed','completed') AND NOT EXISTS(SELECT 1 FROM image_attempts a WHERE a.job_id=image_jobs.id AND a.capacity_until>now())", [s.user_id, s.submission_id]);
            await client.query("DELETE FROM image_submissions WHERE user_id=$1 AND submission_id=$2 AND NOT EXISTS(SELECT 1 FROM image_jobs WHERE user_id=$1 AND submission_id=$2)", [s.user_id, s.submission_id]);
        }
    });
}
export async function beginAccountDeletion(userId: string) {
    await withTransaction(async (client) => {
        await scheduler(client);
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
        const active = await queryOne<any>("SELECT 1 FROM image_attempts WHERE user_id=$1 AND (capacity_until>now() OR lease_until>now() AND terminal_at IS NULL) LIMIT 1", [userId], client);
        const upload = await queryOne("SELECT 1 FROM image_objects o JOIN image_attempts a ON a.id=o.attempt_id WHERE a.user_id=$1 AND o.upload_until>now() LIMIT 1", [userId], client);
        if (active || upload)
            throw new AccountUnavailableError("Your account has image requests in progress. Wait for them to finish before deleting it.", 409);
        await client.query('UPDATE "user" SET image_deleting=true WHERE id=$1', [userId]);
        await client.query("UPDATE image_jobs SET state='failed',error='Account deletion in progress',updated_at=now() WHERE user_id=$1 AND state='queued'", [userId]);
        await client.query("INSERT INTO image_cleanup(user_id) VALUES($1) ON CONFLICT DO NOTHING", [userId]);
    });
}
export function startGenerationWorker() {
    const role = process.env.APP_ROLE || "combined";
    const id = `${process.env.FLY_MACHINE_ID || hostname()}:${process.pid}:${randomUUID()}`;
    const limit = Number(process.env.IMAGE_WORKER_CONCURRENCY || (role === "worker" ? 64 : 128));
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Invalid IMAGE_WORKER_CONCURRENCY");
    const running = new Set<Promise<void>>();
    let stopped = false;
    let ticking = false;
    let lastCleanup = 0;
    const ready = registerWorker(id, role);
    const execute = async (j: ClaimedJob) => {
        let lost = false;
        let beating = false;
        const beat = setInterval(() => {
            if (beating)
                return;
            beating = true;
            void heartbeat(j.attempt_id, j.execution_token).catch(() => { lost = true; }).finally(() => { beating = false; });
        }, 15000);
        const ctx = attemptContext(j);
        const check = ctx.check;
        ctx.check = async () => {
            if (lost)
                throw new OwnershipLostError("Worker lost its lease.");
            await check();
        };
        try {
            await accountContext.run(j.user_id, () => imageAttemptContext.run(ctx, async () => {
                assertParticipation(await participationStatus(j.user_id), true);
                if (j.work.kind === "modify")
                    await modifyPoster(j.user_id, j.work.body);
                else if (j.work.kind === "variant")
                    await variantPoster(j.user_id, j.work.body);
                else {
                    const { input, planned } = j.work;
                    const body = input.generate;
                    const editor = body.editor as any;
                    const slot = `${body.styleId}::${body.paletteId}`;
                    await generatePoster(j.user_id, { ...body, spec: planned.spec, prompt: planned.spec.finalPrompt, promptCost: 0,
                        editor: editor ? { ...editor, specs: { ...editor.specs, [slot]: planned.spec }, planCosts: { ...editor.planCosts, [slot]: planned.cost } } : undefined });
                }
                await ctx.check();
                await publishAttempt(j.attempt_id);
            }));
        }
        catch (error) {
            try {
                if (await recoverPublication(j.attempt_id, j.execution_token))
                    return;
            }
            catch { /* Lease recovery handles inaccessible or incomplete files. */ }
            try {
                await failAttempt(j, error);
            }
            catch {
                console.error("Unable to record image failure", j.id);
            }
        }
        finally {
            clearInterval(beat);
        }
    };
    const tick = async () => {
        if (ticking || stopped)
            return;
        ticking = true;
        try {
            await ready;
            await query("UPDATE image_workers SET heartbeat_at=now() WHERE id=$1", [id]);
            await recoverJobs();
            while (!stopped && running.size < limit) {
                const jobs = await claimJobs(id, limit - running.size);
                if (!jobs.length)
                    break;
                for (const j of jobs) {
                    const p = execute(j).finally(() => running.delete(p));
                    running.add(p);
                }
            }
            if (Date.now() - lastCleanup > 60000) {
                lastCleanup = Date.now();
                await cleanupImageStorage();
            }
        }
        catch {
            console.error("Image worker tick failed", id);
        }
        finally {
            ticking = false;
        }
    };
    const timer = setInterval(() => { void tick(); }, 1000);
    void tick();
    const stop = async () => { stopped = true; clearInterval(timer); await ready; await query("UPDATE image_workers SET draining=true WHERE id=$1", [id]); await Promise.allSettled([...running]); };
    process.once("SIGTERM", () => { void stop().then(async () => { await logger.flush(); process.exit(0); }); });
    process.once("SIGINT", () => { void stop().then(async () => { await logger.flush(); process.exit(0); }); });
    return stop;
}
