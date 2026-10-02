import assert from "node:assert/strict";
import { test } from "node:test";
import { GenerationJobQueue } from "./generationJobs";
import { OpenRouterError } from "./openrouter";
import type { PlannerInput } from "./planner";
import type { PosterSpec } from "./posterSpec";

function setup() {
  const planned = { spec: { text: { title: "Rideau" } } as PosterSpec, cost: 0.01, model: "planner" };
  const input = {
    plan: { title: "Rideau", style: { id: "test" }, referenceBatchId: "refs" } as PlannerInput,
    generate: { activityId: 1, referenceBatchId: "refs", model: "test", styleId: "test", paletteId: "auto", editor: {}, variants: 2 },
  };
  const work = {
    getActivity: async () => ({ id: 1 } as any), resolveReferences: async () => [], maxImageOutputs: async () => 1,
    plan: async (_user: string, _input: PlannerInput) => planned,
    generate: async (_user: string, body: any) => {
      assert.deepEqual(body.spec, planned.spec);
      assert.equal(body.promptCost, 0.01);
      assert.deepEqual(body.editor.specs["test::auto"], planned.spec);
      return [];
    },
  };
  return { queue: new GenerationJobQueue(work), input, work };
}

test("55-job batches deduplicate simultaneous submission and limit stage concurrency", async () => {
  const { queue, input } = setup();
  const body = { submissionId: "batch", jobs: Array.from({ length: 55 }, () => structuredClone(input)) };
  const [first, duplicate] = await Promise.all([queue.submit("owner", body), queue.submit("owner", body)]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.length, 55);
  assert.ok(first.every(job => job.variants === 1), "counts match the provider's output limit");
  assert.deepEqual(queue.list("other"), []);
  const claims = Array.from({ length: 10 }, () => queue.claim("planning")).filter(job => !!job);
  assert.equal(claims.length, Number(process.env.OPENROUTER_PLAN_CONCURRENCY || 4));
  assert.equal(new Set(claims.map(job => job.id)).size, claims.length);
  await Promise.all(claims.map(job => queue.run(job)));
  const images = Array.from({ length: 10 }, () => queue.claim("generating")).filter(job => !!job);
  assert.equal(images.length, Math.min(claims.length, Number(process.env.OPENROUTER_IMAGE_CONCURRENCY || 4)));
  await Promise.all(images.map(job => queue.run(job)));
  assert.equal(queue.list("owner").length, 55 - images.length);
  assert.equal((await queue.submit("owner", body)).length, 55, "completed jobs still prevent duplicate submission");
  assert.deepEqual(new GenerationJobQueue().list("owner"), [], "a fresh backend intentionally has no old jobs");
});

test("image failure is not automatically retried and explicit retry reuses the plan", async () => {
  const { queue, input, work } = setup();
  let plans = 0;
  let images = 0;
  const originalPlan = work.plan;
  work.plan = async (...args) => { plans++; return originalPlan(...args); };
  const originalGenerate = work.generate;
  work.generate = async (...args) => {
    images++;
    if (images === 1) throw new Error("Image connection interrupted");
    return originalGenerate(...args);
  };
  const [job] = await queue.submit("owner", { submissionId: "image-failure", jobs: [input] });
  await queue.run(queue.claim("planning")!);
  assert.equal(images, 0);
  const claimed = queue.claim("generating")!;
  await Promise.all([queue.run(claimed), queue.run(claimed)]);
  assert.equal(images, 1, "a claimed job cannot run twice");
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.match(queue.list("owner")[0].error!, /interrupted/);
  assert.equal(queue.claim("generating"), undefined, "failed images require an explicit retry");
  assert.throws(() => queue.retry("other", job.id), /not found/);
  queue.dismiss("other", job.id);
  assert.equal(queue.list("owner").length, 1);
  queue.retry("owner", job.id);
  assert.throws(() => queue.retry("owner", job.id), /not found/, "double clicks cannot retry active work");
  await queue.run(queue.claim("generating")!);
  assert.equal(plans, 1);
  assert.equal(images, 2);
  assert.deepEqual(queue.list("owner"), []);
});

test("failed planning retries planning; failed validation admits no partial batch", async () => {
  const { queue, input, work } = setup();
  const originalPlan = work.plan;
  work.plan = async () => { throw new Error("Planner failed"); };
  const [job] = await queue.submit("owner", { submissionId: "plan-failure", jobs: [input] });
  await queue.run(queue.claim("planning")!);
  assert.equal(queue.retry("owner", job.id)[0].state, "queued");
  work.plan = originalPlan;
  await queue.run(queue.claim("planning")!);
  assert.equal(queue.list("owner")[0].state, "ready");
  const malformed = { ...input, generate: { ...input.generate, referenceBatchId: "different" } };
  await assert.rejects(queue.submit("owner", { submissionId: "invalid", jobs: [input, malformed] }), /matching uploaded/);
  assert.equal(queue.list("owner").length, 1);
  await queue.submit("owner", { submissionId: "invalid", jobs: [input] });
  assert.equal(queue.list("owner").length, 2, "a rejected submission can be corrected and resubmitted");
});

test("finished and failed jobs expire after 24 hours while queued work remains", async t => {
  const { queue, input, work } = setup();
  const start = Date.now();
  t.mock.method(Date, "now", () => start);
  await queue.submit("owner", { submissionId: "finished", jobs: [input] });
  await queue.run(queue.claim("planning")!);
  await queue.run(queue.claim("generating")!);
  work.plan = async () => { throw new Error("Fail"); };
  await queue.submit("owner", { submissionId: "failed", jobs: [input] });
  await queue.run(queue.claim("planning")!);
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
    const originalPlan = work.plan;
    work.plan = async (...args) => { plans++; return originalPlan(...args); };
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
    await queue.run(queue.claim("planning")!);
    await queue.run(queue.claim("generating")!);
    assert.equal(queue.list("owner")[0].state, "ready");
    assert.equal(queue.list("owner")[0].error, null);
    assert.equal(queue.claim("generating"), undefined);
    await queue.submit("owner", { submissionId: "other", jobs: [input] });
    await queue.run(queue.claim("planning")!);
    await queue.run(queue.claim("generating")!);
    assert.equal(images, 2, "another image can run while the first backs off");
    now += 5999;
    assert.equal(queue.claim("generating"), undefined);
    now++;
    const retry = queue.claim("generating")!;
    assert.equal(queue.list("owner")[0].imageAttempt, 2);
    await queue.run(retry);
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
  await queue.run(queue.claim("planning")!);
  await queue.run(queue.claim("generating")!);
  now += 5000;
  await queue.run(queue.claim("generating")!);
  now += 14999;
  assert.equal(queue.claim("generating"), undefined);
  now++;
  await queue.run(queue.claim("generating")!);
  assert.equal(images, 3);
  assert.equal(queue.list("owner")[0].state, "failed");
  assert.equal(queue.list("owner")[0].error, "Still unavailable");
  assert.equal(queue.claim("generating"), undefined);
  assert.equal(queue.retry("owner", job.id)[0].imageAttempt, 0);
  await queue.run(queue.claim("generating")!);
  assert.equal(images, 4);
  assert.equal(queue.list("owner")[0].state, "ready");
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
    await queue.run(queue.claim("planning")!);
    await queue.run(queue.claim("generating")!);
    assert.equal(queue.list("owner")[0].state, "failed");
    assert.equal(images, 1);
    assert.equal(queue.claim("generating"), undefined);
  }
});
