import assert from "node:assert/strict";
import test from "node:test";
import { addThemeBatchVariant, advanceThemeBatch, createThemeBatch, themeBatchSlots, type BatchTemplate, type ThemeBatchRun } from "./themeBatch";
import type { PosterRecord } from "../api";
import type { ServerGenerationJob } from "../gallery/generationState";

const template: BatchTemplate = { plan: { title: "A route", grounding: [{ index: 1 }] },
  generate: { styleId: "swiss", paletteId: "red", activityId: 42, model: "test/model" } };
function run(variants = 1) { return createThemeBatch({ title: "A route", references: ["image"], templates: [template], variants }, "owner"); }
const completed = { id: "job", state: "completed", title: "A route", model: "test/model", variants: 1,
  error: null, resultPosterIds: ["poster"] } satisfies ServerGenerationJob;
const poster = { posterId: "poster" } as PosterRecord;
const services = {
  upload: async () => ({ referenceBatchId: "refs" }), save: async (_r: ThemeBatchRun) => {},
  submit: async () => [completed], fetchPoster: async () => poster,
  sleep: async () => {}, shouldStop: () => false, changed: () => {},
};

test("all preset combinations have unique keys and receive exactly n single-image tasks", () => {
  const slots = themeBatchSlots();
  assert.equal(new Set(slots.map(s => s.styleId)).size, 13);
  assert.equal(slots.length, 29);
  assert.equal(new Set(slots.map(s => s.key)).size, slots.length);
  assert.ok(slots.every(s => s.styleId !== "custom"));
  const batch = createThemeBatch({ title: "Route", references: ["image"], variants: 4,
    templates: slots.map(slot => ({ plan: {}, generate: slot })) }, "owner");
  assert.equal(batch.tasks.length, 116);
  assert.equal(new Set(batch.tasks.map(t => t.submissionId)).size, 116);
  for (let i = 0; i < 29; i++) assert.equal(batch.tasks.filter(t => t.template === i).length, 4);
  for (const n of [0, -1, 1.5, NaN, 101]) assert.throws(() => run(n), /1–100/);
});

test("an accepted request with a lost response resumes with the identical persisted body and ID", async () => {
  const batch = run();
  let saved: ThemeBatchRun | undefined;
  let first: unknown;
  await assert.rejects(advanceThemeBatch(batch, { ...services,
    save: async r => { saved = structuredClone(r); },
    submit: async body => { assert.ok(saved?.tasks[0].body); first = structuredClone(body); throw new Error("lost connection"); },
  }), /lost connection/);
  assert.ok(saved);
  let uploads = 0;
  await advanceThemeBatch(saved, { ...services,
    upload: async () => { uploads++; return { referenceBatchId: "different" }; },
    submit: async body => { assert.deepEqual(body, first); return [completed]; },
  });
  assert.equal(uploads, 0);
  assert.equal(saved.tasks[0].posters?.[0].posterId, "poster");
});

test("polls accepted jobs, pauses between windows, and skips finished tasks on resume", async () => {
  const batch = run(9);
  let stopped = false;
  let calls = 0;
  await advanceThemeBatch(batch, { ...services,
    submit: async () => { calls++; return [{ ...completed, state: calls === 1 ? "queued" : "completed" }]; },
    changed: () => { stopped = true; }, shouldStop: () => stopped,
  });
  assert.equal(calls, 8);
  assert.equal(batch.tasks.filter(t => t.posters?.length).length, 7);
  const remaining = [batch.tasks[0].submissionId, batch.tasks[8].submissionId];
  const resumed: string[] = [];
  await advanceThemeBatch(batch, { ...services, submit: async body => {
    resumed.push(body.submissionId); return [completed];
  } });
  assert.deepEqual(resumed, remaining);
  assert.ok(batch.tasks.every(t => t.posters?.length));
});

test("fills eight concurrent slots and completes the remaining images without exceeding eight", async () => {
  const batch = run(19);
  let active = 0;
  let maximum = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await advanceThemeBatch(batch, { ...services, submit: async body => {
    assert.ok(batch.tasks.find(t => t.submissionId === body.submissionId)?.body);
    active++; calls++; maximum = Math.max(maximum, active);
    if (active === 8) release();
    await gate;
    active--;
    return [completed];
  } });
  assert.equal(maximum, 8);
  assert.equal(calls, 19);
  assert.ok(batch.tasks.every(t => t.posters?.length));
});

test("a failed request saves successful siblings and stops before admitting another window", async () => {
  const batch = run(10);
  let calls = 0;
  let saved: ThemeBatchRun | undefined;
  await assert.rejects(advanceThemeBatch(batch, { ...services,
    save: async r => { saved = structuredClone(r); },
    submit: async () => {
      calls++;
      return [{ ...completed, state: calls === 1 ? "failed" : "completed", error: "Provider rejected image" }];
    },
  }), /Provider rejected image/);
  assert.equal(calls, 8);
  assert.equal(saved?.tasks.filter(t => t.posters?.length).length, 7);
  assert.equal(batch.tasks[8].body, undefined);
});


test("an additional variant generates only its selected combination without replacing candidates or winners", async () => {
  const batch = createThemeBatch({ title: "Route", references: ["image"], variants: 2,
    templates: [template, { plan: { title: "Route" }, generate: { styleId: "modernist", paletteId: "studio" } }] }, "owner");
  batch.tasks[0].posters = [poster];
  batch.winners["swiss::red"] = "poster";
  const prior = structuredClone(batch.tasks);
  const extra = addThemeBatchVariant(batch, 1);
  assert.equal(batch.tasks.length, 5);
  assert.equal(extra.template, 1);
  assert.ok(!prior.some(t => t.submissionId === extra.submissionId));
  assert.deepEqual(batch.tasks.slice(0, 4), prior);
  const requests: unknown[] = [];
  await advanceThemeBatch(batch, { ...services, taskIds: [extra.submissionId], submit: async body => {
    requests.push(body);
    assert.equal(body.jobs[0].generate.styleId, "modernist");
    assert.equal(body.jobs[0].generate.paletteId, "studio");
    assert.equal(body.jobs[0].generate.variants, 1);
    return [completed];
  } });
  assert.equal(requests.length, 1);
  assert.ok(extra.posters?.length);
  assert.deepEqual(batch.tasks.slice(0, 4), prior);
  assert.equal(batch.winners["swiss::red"], "poster");
  assert.throws(() => addThemeBatchVariant(batch, -1), /Unknown theme/);
  assert.throws(() => addThemeBatchVariant(batch, 2), /Unknown theme/);
});


test("retry requeues the existing failed job once and generates only the selected variant", async () => {
  const batch = run(2);
  batch.tasks[0].error = "Old failure";
  const id = batch.tasks[0].submissionId;
  let polls = 0;
  const retries: string[] = [];
  await advanceThemeBatch(batch, { ...services, taskIds: [id], retryTaskIds: [id],
    retry: async jobId => { retries.push(jobId); },
    submit: async body => {
      assert.equal(body.submissionId, id);
      return [{ ...completed, state: ++polls === 1 ? "failed" : "completed", error: "Provider failed" }];
    },
  });
  assert.deepEqual(retries, ["job"]);
  assert.equal(batch.tasks[0].error, undefined);
  assert.ok(batch.tasks[0].posters?.length);
  assert.equal(batch.tasks[1].body, undefined);
});

test("another failed retry is persisted and stops without automatically retrying again", async () => {
  const batch = run();
  let count = 0;
  let saved: ThemeBatchRun | undefined;
  await assert.rejects(advanceThemeBatch(batch, { ...services,
    taskIds: [batch.tasks[0].submissionId], retryTaskIds: [batch.tasks[0].submissionId],
    retry: async () => { count++; }, save: async run => { saved = structuredClone(run); },
    submit: async () => [{ ...completed, state: "failed", error: "Provider failed again", retryAllowedAt: "2027-01-01T00:00:00Z" }],
  }), /Provider failed again/);
  assert.equal(count, 1);
  assert.equal(saved?.tasks[0].error, "Provider failed again");
  assert.equal(saved?.tasks[0].retryAllowedAt, "2027-01-01T00:00:00Z");
});


test("requests appended while running join the shared eight-image queue", async () => {
  const batch = run(1);
  const ids = [batch.tasks[0].submissionId];
  let preparations = 0;
  const seen: string[] = [];
  await advanceThemeBatch(batch, { ...services, taskIds: ids, prepare: async () => {
    if (++preparations === 2) {
      for (let i = 0; i < 10; i++) ids.push(addThemeBatchVariant(batch, 0).submissionId);
    }
  }, submit: async body => { seen.push(body.submissionId); return [completed]; } });
  assert.equal(seen.length, 11);
  assert.equal(new Set(seen).size, 11);
  assert.ok(batch.tasks.every(t => t.posters?.length));
});

test("multiple retries share a queue and a terminal failure does not block the others", async () => {
  const batch = run(3);
  const ids = batch.tasks.map(t => t.submissionId);
  const retried: string[] = [];
  const attempts = new Map<string, number>();
  await assert.rejects(advanceThemeBatch(batch, { ...services, taskIds: ids, retryTaskIds: ids,
    continueOnError: true, retry: async id => { retried.push(id); },
    submit: async body => {
      const count = (attempts.get(body.submissionId) || 0) + 1;
      attempts.set(body.submissionId, count);
      return [{ ...completed, id: body.submissionId,
        state: count === 1 || body.submissionId === ids[0] ? "failed" : "completed", error: "Still failed" }];
    },
  }), /Still failed/);
  assert.deepEqual(retried.sort(), [...ids].sort());
  assert.equal(batch.tasks.filter(t => t.posters?.length).length, 2);
  assert.equal(batch.tasks[0].error, "Still failed");
});

test("an ambiguous network failure pauses new work rather than exceeding server concurrency", async () => {
  const batch = run(10);
  let requests = 0;
  await assert.rejects(advanceThemeBatch(batch, { ...services, continueOnError: true,
    submit: async () => { requests++; throw new Error("Lost response"); },
  }), /Lost response/);
  assert.equal(requests, 8);
  assert.equal(batch.tasks[8].body, undefined);
});
