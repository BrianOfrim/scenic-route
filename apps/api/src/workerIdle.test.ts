import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { useBootstrapFixture } from "./bootstrapFixture.test-support";
import { query, queryOne, getPool } from "./db";
import { admitJobs, retryGenerationJob, startGenerationWorker, generationWorkerStatus, type PreparedJob } from "./durableJobs";

useBootstrapFixture();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
    const deadline = Date.now() + 5000;
    while (!check()) {
        if (Date.now() > deadline) throw new Error("Worker did not become idle");
        await wait(10);
    }
}
test("combined worker sleeps without SQL, wakes after committed admission and retry, and checks existing work on restart", async t => {
    const previousRole = process.env.APP_ROLE;
    process.env.APP_ROLE = "combined";
    let stop: (() => Promise<void>) | undefined;
    try {
        const userId = randomUUID();
        await query(`INSERT INTO "user"(id,name,email,"emailVerified",beta_status) VALUES($1,'Idle test',$2,true,'admitted')`, [userId, `${userId}@example.com`]);
        const prepared = (): PreparedJob[] => [{ id: randomUUID(), work: { kind: "variant", body: { posterId: "20260101T000000Z-aaaa" } }, details: { title: "Idle test", model: "test/model", variants: 1, activityId: 1 } }];
        stop = startGenerationWorker();
        await until(() => generationWorkerStatus()?.state === "sleeping");
        const pool = await getPool();
        const spy = t.mock.method(pool, "query");
        await wait(1200);
        assert.equal(spy.mock.callCount(), 0, "an empty worker must issue no background SQL");
        spy.mock.restore();
        const checkBefore = generationWorkerStatus()!.lastSuccessfulTick;
        const [job] = await admitJobs(userId, randomUUID(), "idle-test", prepared());
        // No participation consent: execution fails before making a provider request.
        await until(() => generationWorkerStatus()?.state === "sleeping" && generationWorkerStatus()!.lastSuccessfulTick !== checkBefore);
        assert.equal((await queryOne<any>("SELECT state FROM image_jobs WHERE id=$1", [job.id]))!.state, "failed");
        const retryBefore = generationWorkerStatus()!.lastSuccessfulTick;
        await retryGenerationJob(userId, job.id);
        await until(() => generationWorkerStatus()?.state === "sleeping" && generationWorkerStatus()!.lastSuccessfulTick !== retryBefore);
        assert.equal((await queryOne<any>("SELECT attempt_no FROM image_jobs WHERE id=$1", [job.id]))!.attempt_no, 2);
        await stop(); stop = undefined;
        const [queued] = await admitJobs(userId, randomUUID(), "restart-test", prepared());
        stop = startGenerationWorker();
        await until(() => generationWorkerStatus()?.state === "sleeping");
        assert.equal((await queryOne<any>("SELECT state FROM image_jobs WHERE id=$1", [queued.id]))!.state, "failed");
    } finally {
        await stop?.();
        if (previousRole === undefined) delete process.env.APP_ROLE;
        else process.env.APP_ROLE = previousRole;
    }
});
