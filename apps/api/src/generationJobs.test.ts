import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationJobQueue, type JobInput } from "./generationJobs";
import { withAccountAccess } from "./accountLifecycle";
import { RequestQueue } from "./requestQueue";
import { OpenRouterError } from "./openrouter";
import type { PlannerInput } from "./planner";
import type { PosterSpec } from "./posterSpec";

const unlocked: typeof withAccountAccess = async (_user, _exclusive, run) => run({} as any);

function setup() {
  const planned = { spec: { text: { title: "Rideau" }, finalPrompt: "Prepared route prompt", promptTemplateVersion: 1 } as PosterSpec, cost: 0 as const };
  const input: JobInput = {
    plan: { activity: {}, title: "Rideau", subtitle: "", stats: [], style: { id: "test", label: "Test", prompt: "Test style" }, aspectRatio: "3:4", geography: [], pois: [], grounding: [], referenceBatchId: "refs" },
    generate: { activityId: 1, referenceBatchId: "refs", model: "test", styleId: "test", paletteId: "auto", editor: {}, variants: 2 },
  };
  const work = {
    getActivity: async () => ({ id: 1 } as any), resolveReferences: async () => [], maxImageOutputs: async () => 1,
    prepare: (_input: PlannerInput) => planned,
    generate: async (_user: string, body: any) => {
      assert.deepEqual(body.spec, planned.spec);
      assert.equal(body.promptCost, 0);
      assert.equal(body.promptModel, undefined);
      assert.equal(body.prompt, planned.spec.finalPrompt);
      assert.deepEqual(body.editor.specs["test::auto"], planned.spec);
      return [];
    },
  };
  return { queue: new GenerationJobQueue(work, new RequestQueue(128, Infinity, 240_000, 8, 16), unlocked), input, work };
}

test("eight-job batches deduplicate simultaneous submission and limit stage concurrency", async () => {
  const { queue, input, work } = setup();
  const releases: (() => void)[] = [];
  const originalGenerate = work.generate;
  work.generate = async (...args) => { await new Promise<void>(resolve => releases.push(resolve)); return originalGenerate(...args); };
  const body = { submissionId: "batch", jobs: Array.from({ length: 8 }, () => structuredClone(input)) };
  const [first, duplicate] = await Promise.all([queue.submit("owner", body), queue.submit("owner", body)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.length, 8);
  assert.ok(first.every(job => job.activityId === 1 && Number.isFinite(Date.parse(job.createdAt))));
  assert.ok(first.every(job => job.variants === 1), "counts match the provider's output limit");
  assert.deepEqual(queue.list("other"), []);
  const pending = queue.dispatch();
  await Promise.resolve();
  assert.equal(queue.list("owner").filter(job => job.state === "generating").length, 8);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 0);
  assert.equal(queue.dispatch().length, 0, "waiting jobs cannot be scheduled twice");
  work.generate = originalGenerate;
  releases.forEach(release => release());
  await Promise.all(pending);
  assert.equal(queue.list("owner").length, 0);
  assert.equal((await queue.submit("owner", body)).length, 8, "completed jobs still prevent duplicate submission");
  assert.deepEqual(new GenerationJobQueue().list("owner"), [], "a fresh backend intentionally has no old jobs");
});

test("image failure is not automatically retried and explicit retry reuses the plan", async () => {
  const { queue, input, work } = setup();
  let plans = 0;
  let images = 0;
  const originalPlan = work.prepare;
  work.prepare = (...args) => { plans++; return originalPlan(...args); };
  const originalGenerate = work.generate;
  work.generate = async (...args) => {
    images++;
    if (images === 1) throw new Error("Image connection interrupted");
    return originalGenerate(...args);
  };
  const [job] = await queue.submit("owner", { submissionId: "image-failure", jobs: [input] });
  assert.equal(images, 0);
  const pending = queue.dispatch();
  await Promise.all([...pending, ...queue.dispatch()]);
  assert.equal(images, 1, "a claimed job cannot run twice");
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.match(queue.list("owner")[0].error!, /interrupted/);
  assert.equal(queue.dispatch().length, 0, "failed images require an explicit retry");
  assert.throws(() => queue.retry("other", job.id), /not found/);
  queue.dismiss("other", job.id);
  assert.equal(queue.list("owner").length, 1);
  queue.retry("owner", job.id);
  assert.throws(() => queue.retry("owner", job.id), /not found/, "double clicks cannot retry active work");
  await Promise.all(queue.dispatch());
  assert.equal(plans, 1);
  assert.equal(images, 2);
  assert.deepEqual(queue.list("owner"), []);
});

test("failed preparation and reference validation admit no partial batch", async () => {
  const { queue, input, work } = setup();
  const originalPrepare = work.prepare;
  work.prepare = () => { throw new Error("Invalid template input"); };
  await assert.rejects(queue.submit("owner", { submissionId: "invalid", jobs: [input] }), /Invalid template/);
  assert.equal(queue.list("owner").length, 0);
  work.prepare = originalPrepare;
  const malformed = { ...input, generate: { ...input.generate, referenceBatchId: "different" } };
  await assert.rejects(queue.submit("owner", { submissionId: "invalid", jobs: [input, malformed] }), /matching uploaded/);
  assert.equal(queue.list("owner").length, 0);
  const mismatch = structuredClone(input);
  mismatch.plan.grounding = [{ index: 1, role: "route-only", legend: "" }];
  await assert.rejects(queue.submit("owner", { submissionId: "invalid", jobs: [input, mismatch] }), /metadata must match/);
  assert.equal(queue.list("owner").length, 0);
  await queue.submit("owner", { submissionId: "invalid", jobs: [input] });
  assert.equal(queue.list("owner").length, 1, "a rejected submission can be corrected and resubmitted");
});

test("finished and failed jobs expire after 24 hours while queued work remains", async t => {
  const { queue, input, work } = setup();
  const start = Date.now();
  t.mock.method(Date, "now", () => start);
  await queue.submit("owner", { submissionId: "finished", jobs: [input] });
  await Promise.all(queue.dispatch());
  work.generate = async () => { throw new Error("Fail"); };
  await queue.submit("owner", { submissionId: "failed", jobs: [input] });
  await Promise.all(queue.dispatch());
  const [queued] = await queue.submit("owner", { submissionId: "queued", jobs: [input] });
  t.mock.method(Date, "now", () => start + 25 * 60 * 60 * 1000);
  assert.deepEqual(queue.list("owner").map(job => job.id), [queued.id]);
  assert.equal((await queue.submit("owner", { submissionId: "queued", jobs: [input] }))[0].id, queued.id,
    "active batches remain deduplicated even after the retention period");
});

for (const status of [502, 503, 504]) {
  test(`upstream HTTP ${status} retries reuse the plan and release slots during backoff`, async t => {
    const { queue, input, work } = setup();
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    t.mock.method(Math, "random", () => 0.5);
    let plans = 0;
    let images = 0;
    const originalPlan = work.prepare;
    work.prepare = (...args) => { plans++; return originalPlan(...args); };
    const originalGenerate = work.generate;
    work.generate = async (...args) => {
      images++;
      if (images === 1) {
        const error = new OpenRouterError("Provider failed");
        error.upstreamStatus = status;
        throw error;
      }
      return originalGenerate(...args);
    };
    await queue.submit("owner", { submissionId: "retry", jobs: [input] });
      await Promise.all(queue.dispatch());
    assert.equal(queue.list("owner")[0].state, "queued");
    assert.equal(queue.list("owner")[0].error, null);
    assert.equal(queue.dispatch().length, 0);
    await queue.submit("owner", { submissionId: "other", jobs: [input] });
      await Promise.all(queue.dispatch());
    assert.equal(images, 2, "another image can run while the first backs off");
    now += 5999;
    assert.equal(queue.dispatch().length, 0);
    now++;
    await Promise.all(queue.dispatch());
    assert.equal((await queue.submit("owner", { submissionId: "retry", jobs: [input] }))[0].imageAttempt, 2);
    assert.equal(images, 3);
    assert.equal(plans, 2, "each job planned once despite the image retry");
    assert.deepEqual(queue.list("owner"), []);
  });
}

test("repeated upstream failures stop after three attempts and allow manual retry", async t => {
  const { queue, input, work } = setup();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  let images = 0;
  work.generate = async () => {
    images++;
    const error = new OpenRouterError("Still unavailable");
    error.upstreamStatus = 502;
    throw error;
  };
  const [job] = await queue.submit("owner", { submissionId: "exhaust", jobs: [input] });
  await Promise.all(queue.dispatch());
  now += 5000;
  await Promise.all(queue.dispatch());
  now += 14999;
  assert.equal(queue.dispatch().length, 0);
  now++;
  await Promise.all(queue.dispatch());
  assert.equal(images, 3);
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.equal(queue.list("owner")[0].error, "Still unavailable");
  assert.equal(queue.dispatch().length, 0);
  assert.equal(queue.retry("owner", job.id)[0].imageAttempt, 0);
  await Promise.all(queue.dispatch());
  assert.equal(images, 4);
  assert.equal(queue.list("owner")[0].state, "queued");
});

test("ambiguous transport failures, invalid payloads, and other HTTP errors do not retry", async () => {
  for (const status of [undefined, 200, 400, 401, 429, 500]) {
    const { queue, input, work } = setup();
    let images = 0;
    work.generate = async () => {
      images++;
      const error = new OpenRouterError("Failed", status === undefined ? 504 : 502);
      error.upstreamStatus = status;
      throw error;
    };
    await queue.submit("owner", { submissionId: "no-retry", jobs: [input] });
      await Promise.all(queue.dispatch());
    assert.equal(queue.list("owner")[0].state, "failed");
    assert.equal(images, 1);
    assert.equal(queue.dispatch().length, 0);
  }
});

test("selection cap counts distinct theme/palette pairs, independently of models and variants", async () => {
  const { queue, input, work } = setup();
  let prepared = 0;
  const prepare = work.prepare;
  work.prepare = (...args) => { prepared++; return prepare(...args); };
  const jobs = Array.from({ length: 8 }, (_, index) => {
    const job = structuredClone(input);
    job.generate.paletteId = `palette-${index}`;
    return job;
  });
  await assert.rejects(queue.submit("owner", { submissionId: "selection-cap", jobs: [...jobs,
    { ...input, generate: { ...input.generate, styleId: "other-theme", paletteId: "palette-0" } }] }), /at most eight/);
  assert.equal(prepared, 0, "reject before any preparation or admission");
  assert.deepEqual(queue.list("owner"), []);
  assert.equal((await queue.submit("owner", { submissionId: "selection-cap", jobs })).length, 8);
  await Promise.all(queue.dispatch());
  const multiModel = jobs.slice(0, 4).flatMap(job => [job, { ...job, generate: { ...job.generate, model: "other-model", variants: 3 } }]);
  assert.equal((await queue.submit("owner", { submissionId: "multi-model", jobs: multiModel })).length, 8);
});

test("gallery and direct requests share owner limits, fairness, and release after failure", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(2, 100, 240_000, 1);
  const queue = new GenerationJobQueue(work, scheduler, unlocked);
  const releases: (() => void)[] = [];
  const order: string[] = [];
  work.generate = async user => {
    order.push(`gallery:${user}`);
    await new Promise<void>(resolve => releases.push(resolve));
    throw new Error("storage failed");
  };
  await queue.submit("a", { submissionId: "a", jobs: [input, input] });
  await queue.submit("b", { submissionId: "b", jobs: [input] });
  const jobs = queue.dispatch();
  const direct = scheduler.run(async () => { order.push("direct:a"); }, null, "a");
  await Promise.resolve();
  assert.deepEqual(order, ["gallery:a", "gallery:b"]);
  assert.equal(queue.list("a")[1].state, "queued");
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["gallery:a", "gallery:b", "gallery:a"]);
  releases.splice(0).forEach(release => release());
  await Promise.all([...jobs, direct]);
  assert.equal(order.at(-1), "direct:a");
  assert.ok(queue.list("a").every(job => job.state === "failed"));
});

test("simultaneous batches atomically enforce sixteen unfinished jobs without partial admission", async () => {
  const { queue, input } = setup();
  const batches = await Promise.allSettled(["first", "second"].map(submissionId =>
    queue.submit("owner", { submissionId, jobs: Array.from({ length: 9 }, () => input) })));
  assert.equal(batches.filter(result => result.status === "fulfilled").length, 1);
  const rejected = batches.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.match(rejected.reason.message, /at most 16 unfinished.*wait for existing work/i);
  assert.equal(queue.list("owner").length, 9);
  assert.equal((await queue.submit("other", { submissionId: "other", jobs: Array.from({ length: 8 }, () => input) })).length, 8,
    "admission is per user, not global");
  await assert.rejects(queue.submit("owner", { submissionId: "oversized", jobs: Array.from({ length: 9 }, () => input) }), /at most 16 unfinished/);
  assert.equal(queue.list("owner").length, 9);
  await Promise.all(queue.dispatch());
  assert.equal((await queue.submit("owner", { submissionId: "oversized", jobs: [input] })).length, 1,
    "rejected submission IDs can be retried without leaked capacity");
});

test("eight active plus eight waiting jobs fill the unfinished allowance", async () => {
  const { queue, input, work } = setup();
  const releases: (() => void)[] = [];
  const original = work.generate;
  work.generate = async (...args) => { await new Promise<void>(resolve => releases.push(resolve)); return original(...args); };
  await queue.submit("owner", { submissionId: "active", jobs: Array.from({ length: 8 }, () => input) });
  const pending = queue.dispatch();
  await Promise.resolve();
  assert.equal(queue.list("owner").filter(job => job.state === "generating").length, 8);
  await queue.submit("owner", { submissionId: "waiting", jobs: Array.from({ length: 8 }, () => input) });
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 16 unfinished/);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 8);
  work.generate = original;
  releases.forEach(release => release());
  await Promise.all(pending);
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 0);
});

test("manual retry checks unfinished capacity before changing failed state and releases it on success", async () => {
  const { queue, input, work } = setup();
  const original = work.generate;
  work.generate = async () => { throw new Error("failed"); };
  const [failed] = await queue.submit("owner", { submissionId: "failed", jobs: [input] });
  await Promise.all(queue.dispatch());
  await queue.submit("owner", { submissionId: "full", jobs: Array.from({ length: 16 }, () => input) });
  assert.throws(() => queue.retry("owner", failed.id), /at most 16 unfinished/);
  assert.equal(queue.list("owner").find(job => job.id === failed.id)!.state, "failed");
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 16);
  work.generate = original;
  await Promise.all(queue.dispatch());
  assert.equal(queue.retry("owner", failed.id)[0].state, "queued");
  assert.throws(() => queue.retry("owner", failed.id), /not found/);
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 0);
});

test("direct active and waiting requests share unfinished admission with gallery batches", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(1, 100, 240_000, 1, 16);
  const queue = new GenerationJobQueue(work, scheduler, unlocked);
  let release!: () => void;
  const active = scheduler.run(() => new Promise<void>(resolve => release = resolve), null, "owner");
  const direct = scheduler.run(async () => {}, null, "owner");
  await queue.submit("owner", { submissionId: "fourteen", jobs: Array.from({ length: 14 }, () => input) });
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 16 unfinished/);
  await assert.rejects(scheduler.run(async () => assert.fail("overflow ran"), undefined, "owner"), /at most 16 unfinished/);
  await Promise.resolve();
  release();
  await Promise.all([active, direct]);
  assert.equal((await queue.submit("owner", { submissionId: "overflow", jobs: [input] })).length, 1);
  await Promise.all(queue.dispatch());
});

test("automatic retries retain admission when all sixteen unfinished places are occupied", async t => {
  const { queue, input, work } = setup();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  const releases: (() => void)[] = [];
  const original = work.generate;
  work.generate = async () => {
    await new Promise<void>(resolve => releases.push(resolve));
    const error = new OpenRouterError("temporary failure");
    error.upstreamStatus = 503;
    throw error;
  };
  const retryJobs = await queue.submit("owner", { submissionId: "active", jobs: Array.from({length: 8}, () => input) });
  const active = queue.dispatch();
  await Promise.resolve();
  await queue.submit("owner", { submissionId: "full", jobs: Array.from({length: 8}, () => input) });
  releases.forEach(release => release());
  await Promise.all(active);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 16);
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 16 unfinished/);
  work.generate = original;
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 8, "backoff jobs retain their places while other jobs run");
  now += 5000;
  await Promise.all(queue.dispatch());
  assert.deepEqual(queue.list("owner"), []);
  const completed = await queue.submit("owner", {submissionId: "active", jobs: [input]});
  assert.ok(completed.every(job => job.imageAttempt === 2));
  assert.equal(completed.length, retryJobs.length);
  assert.equal((await queue.submit("owner", {submissionId: "overflow", jobs: Array.from({length: 16}, () => input)})).length, 16);
});

for (const providerCode of ["insufficient_credit", "in_flight_budget"]) {
  test(`classified ${providerCode} cannot enter transient retries even inside HTTP 503`, async () => {
    const { queue, input, work } = setup();
    let calls = 0;
    work.generate = async () => {
      calls++;
      const error = new OpenRouterError("Manual retry required", 503);
      error.upstreamStatus = 503;
      error.providerCode = providerCode;
      throw error;
    };
    await queue.submit("owner", { submissionId: "billing", jobs: [input] });
    await Promise.all(queue.dispatch());
    assert.equal(queue.list("owner")[0].state, "failed");
    assert.equal(queue.list("owner")[0].error, "Manual retry required");
    assert.equal(queue.dispatch().length, 0);
    assert.equal(calls, 1);
    work.generate = async () => [];
    assert.equal((await queue.submit("owner", { submissionId: "capacity", jobs: Array.from({ length: 8 }, () => input) })).length, 8);
    await Promise.all(queue.dispatch());
  });
}


test("account removal cancels queued jobs, releases waiting capacity, and preserves other owners", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(1, 100, 240_000, 1, 16);
  const queue = new GenerationJobQueue(work, scheduler, unlocked);
  let release!: () => void;
  const active = scheduler.run(() => new Promise<void>(resolve => release = resolve), null, "other");
  await Promise.resolve();
  await queue.submit("owner", { submissionId: "delete", jobs: [input, input] });
  await queue.submit("other", { submissionId: "keep", jobs: [input] });
  const dispatched = queue.dispatch();
  const done = Promise.allSettled(dispatched);
  queue.removeUser("owner");
  assert.deepEqual(queue.list("owner"), []);
  assert.equal(queue.list("other").length, 1);
  assert.equal(scheduler.reserveJobs("owner", 16).length, 16, "deleted jobs released their capacity");
  release();
  await active;
  const results = await done;
  assert.equal(results.filter(result => result.status === "rejected").length, 2);
});

test("account-lock failures release capacity and leave a manually retryable job without calling the provider", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(1, Infinity, 240_000, 1, 16);
  let unavailable = true;
  let calls = 0;
  work.generate = async () => { calls++; return []; };
  const queue = new GenerationJobQueue(work, scheduler, async (_user, _exclusive, run) => {
    if (unavailable) throw new Error("database connection timed out");
    return run({} as any);
  });
  const [job] = await queue.submit("owner", { submissionId: "lock-failure", jobs: [input] });
  const outcomes = await Promise.allSettled(queue.dispatch());
  assert.equal(outcomes[0].status, "rejected", "retain the infrastructure error for worker logging");
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.match(queue.list("owner")[0].error!, /Please retry/);
  assert.equal(calls, 0);
  assert.equal(queue.dispatch().length, 0, "do not automatically retry account failures");
  await scheduler.run(async () => {}, 100, "other");
  unavailable = false;
  queue.retry("owner", job.id);
  await Promise.all(queue.dispatch());
  assert.equal(calls, 1);
  assert.equal(queue.list("owner").length, 0);
});

test("account-lock cleanup failure does not make completed generation retryable", async () => {
  const { input, work } = setup();
  const queue = new GenerationJobQueue(work, new RequestQueue(1), async (_user, _exclusive, run) => {
    await run({} as any);
    throw new Error("unlock failed");
  });
  const [job] = await queue.submit("owner", { submissionId: "unlock-failure", jobs: [input] });
  await Promise.allSettled(queue.dispatch());
  assert.equal(queue.list("owner").length, 0);
  assert.throws(() => queue.retry("owner", job.id), /failed job not found/);
});

test("account removal releases all reservations held by retry backoff", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(128, Infinity, 240_000, 8, 16);
  const queue = new GenerationJobQueue(work, scheduler, unlocked);
  work.generate = async () => {
    const error = new OpenRouterError("temporary failure");
    error.upstreamStatus = 503;
    throw error;
  };
  await queue.submit("owner", {submissionId: "backoff", jobs: Array.from({length: 16}, () => input)});
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 16);
  assert.throws(() => scheduler.reserveJobs("owner", 1), /16 unfinished/);
  queue.removeUser("owner");
  assert.equal(queue.list("owner").length, 0);
  assert.equal(scheduler.reserveJobs("owner", 16).length, 16);
});

test("manual retry waits for failed attempt cleanup before reserving another place", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(128, Infinity, 240_000, 8, 16);
  let release!: () => void;
  work.generate = async () => { throw new Error("failed"); };
  const queue = new GenerationJobQueue(work, scheduler, async (_user, _exclusive, run) => {
    const result = await run({} as any);
    await new Promise<void>(resolve => release = resolve);
    return result;
  });
  const [job] = await queue.submit("owner", {submissionId: "cleanup", jobs: [input]});
  const pending = queue.dispatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.throws(() => queue.retry("owner", job.id), /still finishing/);
  release();
  await Promise.all(pending);
  assert.equal(queue.retry("owner", job.id)[0].state, "queued");
  const remaining = scheduler.reserveJobs("owner", 15);
  assert.throws(() => scheduler.reserveJobs("owner", 1), /16 unfinished/);
  queue.removeUser("owner");
  remaining.forEach(reservation => scheduler.releaseJob(reservation));
  assert.equal(scheduler.reserveJobs("owner", 16).length, 16);
});
