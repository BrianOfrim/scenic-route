import path from "node:path";
import { DATA_DIR, LLM_TRACES_DIR } from "./paths";
import { createHash } from "node:crypto";
import { query, queryOne, withTransaction, type SqlClient } from "./db";
import { imageAttemptContext } from "./jobContext";
import { checkAttempt, heartbeat } from "./durableJobs";
import { assertParticipation, participationStatus } from "./participation";
import { rawPosterStore, createLocalStore, createR2Store, r2Config, type ObjectStore } from "./storage";
export async function registerStagedRecord(record: any) {
    const ctx = imageAttemptContext.getStore();
    if (!ctx)
        return;
    await ctx.check();
    await withTransaction(async (client) => {
        await checkAttempt(ctx.id, client);
        await client.query("INSERT INTO image_records(attempt_id,poster_id,record) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [ctx.id, record.posterId, record]);
        const names = [`${record.posterId}.png`, `${record.posterId}.json`, ...Array.from({ length: record.referenceCount }, (_, i) => `${record.posterId}.ref-${i + 1}.png`), ...(record.annotationUrl ? [`${record.posterId}.annotation.png`] : [])];
        for (const name of names)
            await client.query("INSERT INTO image_objects(attempt_id,name,bytes,sha256) VALUES($1,$2,0,'') ON CONFLICT DO NOTHING", [ctx.id, name]);
        await client.query("UPDATE image_attempts SET phase='staging' WHERE id=$1", [ctx.id]);
    });
}
export async function stageObject(raw: ObjectStore, userId: string, name: string, body: Buffer, type: string) {
    const ctx = imageAttemptContext.getStore();
    if (!ctx)
        throw new Error("Attempt context required");
    await ctx.check();
    await query("INSERT INTO image_storage_attempts(attempt_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [ctx.id, userId]);
    const hash = createHash("sha256").update(body).digest("hex");
    await query("INSERT INTO image_objects(attempt_id,name,bytes,sha256,required,upload_until) VALUES($1,$2,$3,$4,$5,now()+interval '120 seconds') ON CONFLICT(attempt_id,name) DO UPDATE SET bytes=EXCLUDED.bytes,sha256=EXCLUDED.sha256,verified=false,upload_until=EXCLUDED.upload_until", [ctx.id, name, body.length, hash, !name.endsWith(".thumb.webp")]);
    await ctx.check();
    // No connection or transaction is held during the upload.
    try {
        await raw.put(userId, `_attempts/${ctx.id}/${name}`, body, type);
    }
    finally {
        // Stale workers may acknowledge upload completion, but cannot publish.
        try {
            await query("UPDATE image_objects SET upload_until=now() WHERE attempt_id=$1 AND name=$2 AND sha256=$3", [ctx.id, name, hash]);
        }
        catch { /* Retain the bounded unresolved-upload window. */ }
    }
    await ctx.check();
    await query("UPDATE image_objects SET verified=true WHERE attempt_id=$1 AND name=$2 AND sha256=$3", [ctx.id, name, hash]);
}
async function commitPublication(id: string, client: SqlClient, token?: string) {
    const j = await queryOne<any>("SELECT j.* FROM image_jobs j JOIN image_attempts a ON a.job_id=j.id WHERE a.id=$1 FOR UPDATE OF j", [id], client);
    const a = await checkAttempt(id, client, false, token);
    // Lock the account only after obtaining scheduler/account locks in publishAttempt.
    assertParticipation(await participationStatus(a.user_id, undefined, client), true);
    const records = await query<any>("SELECT * FROM image_records WHERE attempt_id=$1 ORDER BY poster_id", [id], client);
    const missing = await queryOne<any>("SELECT 1 FROM image_objects WHERE attempt_id=$1 AND required AND NOT verified LIMIT 1", [id], client);
    if (!records.length || records.length !== a.output_count || missing)
        throw new Error("Incomplete staged image output; regeneration requires manual retry.");
    const ids = records.map(r => r.poster_id);
    for (const r of records)
        await client.query("INSERT INTO poster_publications(user_id,poster_id,object_prefix,record,attempt_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,poster_id) DO NOTHING", [a.user_id, r.poster_id, `_attempts/${id}/`, r.record, id]);
    await client.query("UPDATE image_attempts SET terminal_at=now(),phase='published',manifest_ready=true,poster_ids=$2,capacity_until=now() WHERE id=$1", [id, JSON.stringify(ids)]);
    await client.query("UPDATE image_jobs SET state='completed',result_ids=$2,error=null,failure_reason=null,updated_at=now() WHERE id=$1", [a.job_id, JSON.stringify(ids)]);
    await client.query(`UPDATE image_submissions s SET terminal_at=now() WHERE user_id=$1 AND submission_id=$2 AND terminal_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM image_jobs WHERE user_id=$1 AND submission_id=$2 AND state IN ('queued','generating'))`, [a.user_id, j.submission_id]);
}
export async function publishAttempt(id: string, token?: string) {
    await withTransaction(async (client) => {
        await client.query("SELECT id FROM image_scheduler WHERE id=1 FOR UPDATE");
        const row = await queryOne<any>("SELECT user_id FROM image_attempts WHERE id=$1", [id], client);
        if (!row)
            throw new Error("Attempt not found");
        const u = await queryOne<any>('SELECT image_deleting FROM "user" WHERE id=$1 FOR UPDATE', [row.user_id], client);
        if (!u || u.image_deleting)
            throw new Error("Account unavailable for publication");
        await commitPublication(id, client, token);
    });
}
export async function recoverPublication(id: string, token?: string): Promise<boolean> {
    const a = await checkAttempt(id, undefined, false, token);
    token ??= a.execution_token;
    if (a.output_count === null)
        return false;
    const records = await query<any>("SELECT poster_id FROM image_records WHERE attempt_id=$1", [id]);
    if (records.length !== a.output_count)
        return false;
    const objects = await query<any>("SELECT * FROM image_objects WHERE attempt_id=$1", [id]);
    const raw = rawPosterStore();
    for (const object of objects) {
        await heartbeat(id, token);
        const bytes = await raw.get(a.user_id, `_attempts/${id}/${object.name}`);
        if (!bytes || !object.sha256 || createHash("sha256").update(bytes).digest("hex") !== object.sha256) {
            if (!object.required) continue;
            return false;
        }
        await query("UPDATE image_objects SET verified=true WHERE attempt_id=$1 AND name=$2", [id, object.name]);
    }
    await publishAttempt(id, token);
    return true;
}
export async function backfillPosterIndex(userId?: string) {
    const raw = rawPosterStore();
    const users = userId ? [{ id: userId }] : await query<{
        id: string;
    }>('SELECT id FROM "user"');
    for (const u of users) {
        const key = `poster_index_v1:${u.id}`;
        const done = await queryOne("SELECT 1 FROM settings WHERE key=$1", [key]);
        if (done)
            continue;
        for (const name of await raw.listJsonNames(u.id)) {
            if (name.includes("/"))
                continue; // Attempt paths are never legacy publications.
            const data = await raw.get(u.id, name);
            if (!data)
                continue;
            let record: any;
            try {
                record = JSON.parse(data.toString());
            }
            catch {
                continue;
            }
            if (record.posterId !== name.slice(0, -5))
                continue;
            await query("INSERT INTO poster_publications(user_id,poster_id,record) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [u.id, record.posterId, record]);
        }
        await query("INSERT INTO settings(key,value) VALUES($1,'1') ON CONFLICT DO NOTHING", [key]);
    }
}
export function indexedPosterStore(raw: ObjectStore): ObjectStore {
    const location = async (userId: string, name: string) => {
        const posterId = name.split(".")[0];
        const p = await queryOne<any>("SELECT object_prefix,record FROM poster_publications WHERE user_id=$1 AND poster_id=$2", [userId, posterId]);
        return p ? { ...p, key: `${p.object_prefix}${name}` } : null;
    };
    return { ...raw,
        async migrateUnscopedToUser(u) {
            await raw.migrateUnscopedToUser(u);
            await query("DELETE FROM settings WHERE key=$1", [`poster_index_v1:${u}`]);
            await backfillPosterIndex(u);
        },
        signedUrl: raw.signedUrl ? async (u, n, t) => {
            const p = await location(u, n);
            if (!p)
                throw new Error("image not found");
            return raw.signedUrl!(u, p.key, t);
        } : undefined,
        async get(u, n) {
            const p = await location(u, n);
            if (!p)
                return null;
            if (n.endsWith(".json"))
                return Buffer.from(JSON.stringify(p.record));
            return raw.get(u, p.key);
        },
        async put(u, n, b, t) {
            if (imageAttemptContext.getStore())
                return stageObject(raw, u, n, b, t);
            const p = await location(u, n);
            if (!p)
                throw new Error("Only committed posters may be modified");
            if (n.endsWith(".json")) {
                const r = JSON.parse(b.toString());
                await query("UPDATE poster_publications SET record=$3 WHERE user_id=$1 AND poster_id=$2", [u, r.posterId, r]);
            }
            else
                await raw.put(u, p.key, b, t);
        },
        async listJsonNames(u) { return (await query<any>("SELECT poster_id FROM poster_publications WHERE user_id=$1", [u])).map(p => `${p.poster_id}.json`); },
        async removeByPosterId(u, id) {
            const p = await location(u, `${id}.json`);
            if (!p)
                return;
            // Revoke visibility first, even if deleting files fails.
            await query("DELETE FROM poster_publications WHERE user_id=$1 AND poster_id=$2", [u, id]);
            await raw.removeByPosterId(u, `${p.object_prefix}${id}`);
        },
        async removeByActivityIds(u, ids) {
            let count = 0;
            for (const p of await query<any>("SELECT poster_id,record FROM poster_publications WHERE user_id=$1", [u]))
                if (ids.has(Number(p.record.activityId))) {
                    await this.removeByPosterId(u, p.poster_id);
                    count++;
                }
            return count;
        },
    };
}
export async function cleanupImageStorage() {
    const raw = rawPosterStore();
    // Publication rows, not object age, protect committed attempts from expiry.
    const abandoned = await query<any>(`SELECT a.attempt_id AS id,a.user_id FROM image_storage_attempts a WHERE a.created_at<now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM image_attempts live WHERE live.id=a.attempt_id AND (live.capacity_until>now() OR live.terminal_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM poster_publications p WHERE p.object_prefix='_attempts/'||a.attempt_id||'/') LIMIT 100`);
    for (const a of abandoned) {
        await raw.removePrefix?.(a.user_id, `_attempts/${a.id}/`);
        const config = r2Config();
        if (config)
            await createR2Store(config, "traces/").removePrefix?.(a.user_id, `${a.id}/`);
    }
    const remote = r2Config();
    for (const row of await query<any>("SELECT user_id FROM image_cleanup ORDER BY checked_at NULLS FIRST LIMIT 100")) {
        try {
            await raw.removeUser(row.user_id);
            await createLocalStore(path.join(DATA_DIR, "references")).removeUser(row.user_id);
            await createLocalStore(LLM_TRACES_DIR).removeUser(row.user_id);
            if (remote) {
                await createR2Store(remote, "traces/").removeUser(row.user_id);
                await createR2Store(remote, "references/").removeUser(row.user_id);
            }
            await query("UPDATE image_cleanup SET checked_at=now(),error=null WHERE user_id=$1", [row.user_id]);
        }
        catch {
            await query("UPDATE image_cleanup SET checked_at=now(),error='Storage cleanup failed' WHERE user_id=$1", [row.user_id]);
        }
    }
}
