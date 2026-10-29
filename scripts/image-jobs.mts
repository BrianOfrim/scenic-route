import path from "node:path";
import { config } from "dotenv";
import { REPO_ROOT } from "../apps/api/src/paths";
config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
const [command, target, value] = process.argv.slice(2);
process.env.DB_MIGRATIONS = command === "migrate" ? "on" : "off";
const { initDb, closeDb, query, queryOne, withTransaction } = await import("../apps/api/src/db");
try {
    if (command === "migrate" && process.env.NODE_ENV === "production") {
        const { r2Config } = await import("../apps/api/src/storage");
        if (!r2Config())
            throw new Error("Production backfill requires R2 configuration");
    }
    await initDb();
    if (command === "migrate") {
        process.env.POSTER_INDEX_ENABLED = "false";
        const { sealImportedIdFloors } = await import("../apps/api/src/importedIds");
        const { purgeLegacyApiData } = await import("../apps/api/src/fileFirstMigration");
        await sealImportedIdFloors();
        await purgeLegacyApiData();
        const { backfillPosterIndex } = await import("../apps/api/src/publication");
        await backfillPosterIndex();
        console.log("Image job schema and legacy publication index ready.");
    }
    else if (command === "capacity") {
        if (!target || !/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1)
            throw new Error("Specify a positive global capacity");
        await query("UPDATE image_scheduler SET global_limit=$1 WHERE id=1", [Number(target)]);
        console.log(`Global active image capacity: ${target}`);
    }
    else if (command === "status") {
        const states = await query("SELECT state,count(*)::int count FROM image_jobs GROUP BY state");
        const workers = await query("SELECT id,role,draining,heartbeat_at FROM image_workers WHERE heartbeat_at>now()-interval '24 hours'");
        const attempts = await queryOne(`SELECT count(*) FILTER(WHERE capacity_until>now())::int active,
      count(*) FILTER(WHERE phase='uncertain')::int uncertain FROM image_attempts`);
        const queue = await queryOne("SELECT extract(epoch FROM now()-min(created_at)) oldest_queued_seconds FROM image_jobs WHERE state='queued'");
        const cleanup = await queryOne("SELECT count(*)::int accounts,count(*) FILTER(WHERE error IS NOT NULL)::int failures FROM image_cleanup");
        // Read in-process readiness without refreshing the worker's database heartbeat.
        let runtime = null;
        try {
            const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8790}/api/health`, { signal: AbortSignal.timeout(3000) });
            if (response.ok) runtime = (await response.json() as any).worker ?? null;
        } catch { /* Standalone workers and offline local APIs have no HTTP endpoint. */ }
        console.log(JSON.stringify({ scheduler: await queryOne("SELECT enabled,global_limit FROM image_scheduler WHERE id=1"), states, workers, attempts, queue, cleanup, runtime }, null, 2));
    }
    else if (command === "pause" || command === "resume") {
        await query("UPDATE image_scheduler SET enabled=$1 WHERE id=1", [command === "resume"]);
        console.log(`Submissions ${command === "resume" ? "enabled" : "paused"}; accepted work continues.`);
    }
    else if (command === "drain" || command === "undrain") {
        if (!target)
            throw new Error("Specify a worker ID or all");
        const rows = await query<{
            id: string;
        }>("UPDATE image_workers SET draining=$1 WHERE ($2='all' OR id=$2) RETURNING id", [command === "drain", target]);
        if (!rows.length)
            throw new Error("No matching workers");
        console.log(`${command}: ${rows.map(w => w.id).join(", ")}`);
        if (value === "--wait") {
            for (;;) {
                const n = await queryOne<{
                    n: number;
                }>("SELECT count(*)::int n FROM image_attempts WHERE worker_id=ANY($1::text[]) AND terminal_at IS NULL", [rows.map(w => w.id)]);
                if (!n!.n)
                    break;
                await new Promise(r => setTimeout(r, 5000));
            }
            console.log("Workers drained; safe to replace.");
        }
    }
    else if (command === "reconcile") {
        if (!target || !value || !/^\d+$/.test(value))
            throw new Error("Usage: npm run jobs:reconcile -- <attempt-id> <confirmed-output-count>");
        await withTransaction(async (client) => {
            const j = await queryOne<any>("SELECT j.* FROM image_jobs j JOIN image_attempts a ON a.job_id=j.id WHERE a.id=$1 FOR UPDATE OF j", [target], client);
            if (!j || j.state === "generating")
                throw new Error("Cannot reconcile an active or missing job");
            const a = await queryOne<any>("SELECT * FROM image_attempts WHERE id=$1 FOR UPDATE", [target], client);
            if (!a.quota_id)
                throw new Error("No quota reservation");
            const q = await queryOne<any>("SELECT * FROM poster_generation_usage WHERE id=$1 FOR UPDATE", [a.quota_id], client);
            const count = Number(value);
            if (!q || count > q.reserved)
                throw new Error("Output count exceeds reservation");
            await client.query("UPDATE poster_generation_usage SET generated=$2 WHERE id=$1", [q.id, count]);
            await client.query("UPDATE image_attempts SET output_count=$2,phase='reconciled',capacity_until=now() WHERE id=$1", [target, count]);
            await client.query("UPDATE image_jobs SET retry_allowed_at=null WHERE attempt_id=$1 AND state='failed'", [target]);
        });
        console.log("Confirmed quota outcome recorded; no provider request was sent.");
    }
    else
        throw new Error("Commands: migrate, status, capacity <limit>, pause, resume, drain <worker|all> [--wait], undrain <worker|all>, reconcile <attempt> <count>");
}
catch (error) {
    console.error(error instanceof Error ? error.message : "Image job operation failed");
    process.exitCode = 1;
}
finally {
    await closeDb();
}
