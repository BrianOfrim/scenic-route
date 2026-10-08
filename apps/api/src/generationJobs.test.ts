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
  return { queue: new GenerationJobQueue(work, new RequestQueue(100, 100, 240_000, 4, 8), unlocked), input, work };
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
  assert.equal(queue.list("owner").filter(job => job.state === "generating").length, 4);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 4);
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
  const jobs = Array.from({ length: 4 }, (_, index) => {
    const job = structuredClone(input);
    job.generate.paletteId = `palette-${index}`;
    return job;
  });
  await assert.rejects(queue.submit("owner", { submissionId: "selection-cap", jobs: [...jobs,
    { ...input, generate: { ...input.generate, styleId: "other-theme", paletteId: "palette-0" } }] }), /at most four/);
  assert.equal(prepared, 0, "reject before any preparation or admission");
  assert.deepEqual(queue.list("owner"), []);
  const multiModel = jobs.flatMap(job => [job, { ...job, generate: { ...job.generate, model: "other-model", variants: 3 } }]);
  assert.equal((await queue.submit("owner", { submissionId: "selection-cap", jobs: multiModel })).length, 8);
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

test("simultaneous batches atomically enforce eight waiting jobs without partial admission", async () => {
  const { queue, input } = setup();
  const batches = await Promise.allSettled(["first", "second"].map(submissionId =>
    queue.submit("owner", { submissionId, jobs: Array.from({ length: 5 }, () => input) })));
  assert.equal(batches.filter(result => result.status === "fulfilled").length, 1);
  const rejected = batches.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.match(rejected.reason.message, /at most 8 waiting.*wait for existing work/i);
  assert.equal(queue.list("owner").length, 5);
  assert.equal((await queue.submit("other", { submissionId: "other", jobs: Array.from({ length: 8 }, () => input) })).length, 8,
    "eight is per user, not global");
  await assert.rejects(queue.submit("owner", { submissionId: "oversized", jobs: Array.from({ length: 9 }, () => input) }), /at most 8 waiting/);
  assert.equal(queue.list("owner").length, 5);
  await Promise.all(queue.dispatch());
  assert.equal((await queue.submit("owner", { submissionId: "oversized", jobs: [input] })).length, 1,
    "rejected submission IDs can be retried without leaked capacity");
});

test("four active jobs do not consume the eight waiting-job admission allowance", async () => {
  const { queue, input, work } = setup();
  const releases: (() => void)[] = [];
  const original = work.generate;
  work.generate = async (...args) => { await new Promise<void>(resolve => releases.push(resolve)); return original(...args); };
  await queue.submit("owner", { submissionId: "active", jobs: Array.from({ length: 4 }, () => input) });
  const pending = queue.dispatch();
  await Promise.resolve();
  assert.equal(queue.list("owner").filter(job => job.state === "generating").length, 4);
  await queue.submit("owner", { submissionId: "waiting", jobs: Array.from({ length: 8 }, () => input) });
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 8 waiting/);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 8);
  work.generate = original;
  releases.forEach(release => release());
  await Promise.all(pending);
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 0);
});

test("manual retry checks waiting capacity before changing failed state and releases it on success", async () => {
  const { queue, input, work } = setup();
  const original = work.generate;
  work.generate = async () => { throw new Error("failed"); };
  const [failed] = await queue.submit("owner", { submissionId: "failed", jobs: [input] });
  await Promise.all(queue.dispatch());
  await queue.submit("owner", { submissionId: "full", jobs: Array.from({ length: 8 }, () => input) });
  assert.throws(() => queue.retry("owner", failed.id), /at most 8 waiting/);
  assert.equal(queue.list("owner").find(job => job.id === failed.id)!.state, "failed");
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 8);
  work.generate = original;
  await Promise.all(queue.dispatch());
  assert.equal(queue.retry("owner", failed.id)[0].state, "queued");
  assert.throws(() => queue.retry("owner", failed.id), /not found/);
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner").length, 0);
});

test("direct waiting requests and gallery batches share the per-user waiting allowance", async () => {
  const { input, work } = setup();
  const scheduler = new RequestQueue(1, 100, 240_000, 1, 8);
  const queue = new GenerationJobQueue(work, scheduler, unlocked);
  let release!: () => void;
  const active = scheduler.run(() => new Promise<void>(resolve => release = resolve), null, "owner");
  const direct = scheduler.run(async () => {}, null, "owner");
  await queue.submit("owner", { submissionId: "seven", jobs: Array.from({ length: 7 }, () => input) });
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 8 waiting/);
  await assert.rejects(scheduler.run(async () => assert.fail("overflow ran"), undefined, "owner"), /at most 8 waiting/);
  await Promise.resolve();
  release();
  await Promise.all([active, direct]);
  assert.equal((await queue.submit("owner", { submissionId: "overflow", jobs: [input] })).length, 1);
  await Promise.all(queue.dispatch());
});

test("automatic retries preserve the hard waiting ceiling and failed job when waiting work filled the allowance", async t => {
  const { queue, input, work } = setup();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(Math, "random", () => 0);
  let release!: () => void;
  const original = work.generate;
  work.generate = async () => {
    await new Promise<void>(resolve => release = resolve);
    const error = new OpenRouterError("temporary failure");
    error.upstreamStatus = 503;
    throw error;
  };
  const [retry] = await queue.submit("owner", { submissionId: "active-retry", jobs: [input] });
  const active = queue.dispatch();
  await Promise.resolve();
  await queue.submit("owner", { submissionId: "full", jobs: Array.from({ length: 8 }, () => input) });
  release();
  await Promise.all(active);
  assert.equal(queue.list("owner").filter(job => job.state === "queued").length, 8);
  assert.equal(queue.list("owner").find(job => job.id === retry.id)!.state, "failed");
  assert.match(queue.list("owner").find(job => job.id === retry.id)!.error!, /Automatic retry could not be queued.*Retry this job manually/);
  await assert.rejects(queue.submit("owner", { submissionId: "overflow", jobs: [input] }), /at most 8 waiting/);
  work.generate = original;
  await Promise.all(queue.dispatch());
  assert.deepEqual(queue.list("owner").map(job => job.id), [retry.id], "failed retry remains available after queued jobs complete");
  assert.equal(queue.list("owner")[0].imageAttempt, 1);
  now += 5000;
  await Promise.all(queue.dispatch());
  assert.equal(queue.list("owner")[0].state, "failed", "capacity opening never auto-resumes this failed job");
  queue.retry("owner", retry.id);
  await Promise.all(queue.dispatch());
  assert.deepEqual(queue.list("owner"), []);
  assert.equal((await queue.submit("owner", { submissionId: "overflow", jobs: Array.from({ length: 8 }, () => input) })).length, 8,
    "manual retry completion clears all reservations");
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
  const scheduler = new RequestQueue(1, 100, 240_000, 1, 8);
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
  assert.equal(scheduler.reserveWaiting("owner", 8).length, 8, "deleted jobs released their capacity");
  release();
  await active;
  const results = await done;
  assert.equal(results.filter(result => result.status === "rejected").length, 2);
});
