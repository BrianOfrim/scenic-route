import assert from "node:assert/strict";
import { test } from "node:test";
import { pollPosterJobs } from "../api";
import { getArrivedPosters } from "./arrivedPosters";
import { beginGeneration, clearFailedImage, getGenerationState, trackGeneration } from "./generationState";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("prompt and image generation share placeholders without duplicating or clearing other tasks", async () => {
  const task = beginGeneration({ title: "Full poster", variants: 2 });
  const other = beginGeneration({ title: "Another poster" });
  const ids = getGenerationState().pending.map((image) => image.id);
  assert.equal(ids.length, 3, "all placeholders exist before prompt generation");
  const prompt = deferred<void>();
  const image = deferred<void>();
  const work = (async () => {
    await prompt.promise;
    return trackGeneration({ title: "Full poster", variants: 2 }, () => image.promise, task);
  })();
  assert.deepEqual(getGenerationState().pending.map((item) => item.id), ids);
  prompt.resolve();
  await Promise.resolve();
  assert.deepEqual(getGenerationState().pending.map((item) => item.id), ids, "same placeholders persist into image generation");
  assert.ok(getGenerationState().pending.filter(item => item.title === "Full poster").every(item => item.phase === "generating"));
  image.resolve();
  await work;
  assert.deepEqual(getGenerationState().pending.map((item) => item.title), ["Another poster"]);
  const revision = getGenerationState().revision;
  task.finish();
  assert.equal(getGenerationState().revision, revision, "completion is idempotent");
  other.finish(new Error("Poster generation failed"));
  assert.equal(getGenerationState().pending.length, 0);
  assert.equal(getGenerationState().error, "Poster generation failed");
});

test("phases update all variants of one task, reset on retry, and ignore finished tasks", async () => {
  const task = beginGeneration({ title: "Phase route", variants: 2 });
  const other = beginGeneration({ title: "Queued route" });
  task.setPhase("generating");
  assert.deepEqual(getGenerationState().pending.map(image => image.phase), ["generating", "generating", "queued"]);
  task.setPhase("generating");
  task.setRetry(async () => {
    const images = getGenerationState().pending.filter(image => image.title === "Phase route");
    assert.deepEqual(images.map(image => image.phase), ["queued", "queued"]);
    task.setPhase("generating");
  });
  task.finish(new Error("Retry this phase"));
  const snapshot = getGenerationState();
  task.setPhase("generating");
  assert.equal(getGenerationState(), snapshot, "finished work cannot change active tasks");
  await snapshot.failed.find(image => image.title === "Phase route")!.retry();
  assert.deepEqual(getGenerationState().pending.map(image => image.phase), ["queued"]);
  other.finish();
});


test("failed cards retry once per request, survive repeated failures, and clear after success", async () => {
  let attempts = 0;
  const gate = deferred<void>();
  const task = beginGeneration({ title: "Retry route", variants: 2, model: "test-model" });
  const generate = async () => {
    attempts++;
    if (attempts < 3) throw new Error("Image generation timed out");
    await gate.promise;
  };
  await assert.rejects(trackGeneration({ title: "Retry route" }, generate, task), /timed out/);
  let cards = getGenerationState().failed.filter((image) => image.title === "Retry route");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].error, "Image generation timed out");
  await cards[0].retry();
  cards = getGenerationState().failed.filter((image) => image.title === "Retry route");
  assert.equal(cards.length, 2, "a failed retry retains the cards without duplicates");
  const retry = cards[1].retry();
  await cards[0].retry();
  assert.equal(attempts, 3, "clicking another variant cannot submit the same request twice");
  assert.equal(getGenerationState().failed.filter((image) => image.title === "Retry route").length, 0);
  assert.equal(getGenerationState().pending.filter((image) => image.title === "Retry route").length, 2);
  gate.resolve();
  await retry;
  assert.equal(getGenerationState().pending.filter((image) => image.title === "Retry route").length, 0);
  assert.equal(getGenerationState().failed.filter((image) => image.title === "Retry route").length, 0);
});

test("clearing failed images preserves other failures and pending work without regenerating", () => {
  for (const image of getGenerationState().failed) clearFailedImage(image.id);
  const first = beginGeneration({ title: "Dismiss this" });
  const second = beginGeneration({ title: "Keep this" });
  const pending = beginGeneration({ title: "Still generating" });
  first.setRetry(async () => { assert.fail("clearing must not regenerate"); });
  first.finish(new Error("First failure"));
  second.finish(new Error("Second failure"));
  const [a, b] = getGenerationState().failed;
  const pendingIds = getGenerationState().pending.map(image => image.id);
  clearFailedImage(b.id);
  assert.deepEqual(getGenerationState().failed.map(image => image.id), [a.id]);
  assert.equal(getGenerationState().error, "First failure");
  assert.deepEqual(getGenerationState().pending.map(image => image.id), pendingIds);
  clearFailedImage(a.id);
  assert.equal(getGenerationState().failed.length, 0);
  assert.equal(getGenerationState().error, null, "clearing the last failure also removes its banner");
  const cleared = getGenerationState();
  clearFailedImage(a.id);
  assert.equal(getGenerationState(), cleared, "repeated clearing is harmless");
  pending.finish();
});

test("server jobs restore stages and failed retries after reload and refresh completion", async () => {
  const { setServerGenerationJobs } = await import("./generationState");
  const jobs = ["queued","generating","failed"].map((state,index) => ({
    id: `durable-${index}`, state, title: "Persisted", model: "model", activityId: 7, createdAt: "2026-09-26T00:00:00Z", variants: 2, error: state === "failed" ? "Check before retry" : null,
  })) as import("./generationState").ServerGenerationJob[];
  let retried = "";
  const retry = async (id: string) => { retried = id; };
  const dismiss = async () => {};
  setServerGenerationJobs(jobs,retry,dismiss);
  assert.deepEqual(getGenerationState().pending.map(image => image.phase),["queued","queued","generating","generating"]);
  const failed = getGenerationState().failed.filter(image => image.id.startsWith("server:"));
  assert.equal(failed.length,2);
  assert.ok(getGenerationState().pending.every(image => image.activityId === 7 && image.createdAt === "2026-09-26T00:00:00Z"));
  assert.equal(failed[0].error,"Check before retry");
  await failed[0].retry();
  assert.equal(retried,"durable-2");
  const snapshot = getGenerationState();
  setServerGenerationJobs(jobs,retry,dismiss);
  assert.equal(getGenerationState(),snapshot,"unchanged polling does not reload the gallery");
  setServerGenerationJobs([],retry,dismiss);
  assert.equal(getGenerationState().pending.length,0);
  assert.equal(getGenerationState().failed.filter(image => image.id.startsWith("server:")).length,0);
  assert.ok(getGenerationState().revision>snapshot.revision);
});

test("resubmitting a batch dismisses every local failed placeholder", async () => {
  for (const image of getGenerationState().failed) clearFailedImage(image.id);
  const tasks = [beginGeneration({ title: "Batch A" }),beginGeneration({ title: "Batch B" })];
  tasks.forEach(task => task.setRetry(async () => { tasks.forEach(task => task.dismiss()); }));
  tasks.forEach(task => task.finish(new Error("Submission connection lost")));
  await getGenerationState().failed.find(image => image.title === "Batch A")!.retry();
  assert.equal(getGenerationState().failed.length,0);
  assert.equal(getGenerationState().pending.length,0);
  assert.equal(getGenerationState().error,null);
});


test("server retry attempts appear while queued and generating", async () => {
  const { setServerGenerationJobs } = await import("./generationState");
  const retry = async () => {};
  const job = { id: "retry-attempt", state: "queued" as const, title: "Retry", model: "model", variants: 1, error: null, imageAttempt: 1 };
  setServerGenerationJobs([job], retry, retry);
  let image = getGenerationState().pending.find(image => image.id.startsWith("server:"))!;
  assert.equal(image.phase, "queued");
  assert.equal(image.imageAttempt, 2);
  setServerGenerationJobs([{ ...job, state: "generating", imageAttempt: 2 }], retry, retry);
  image = getGenerationState().pending.find(image => image.id.startsWith("server:"))!;
  assert.equal(image.phase, "generating");
  assert.equal(image.imageAttempt, 2);
  setServerGenerationJobs([], retry, retry);
});


test("job polling publishes completed images before removing activity placeholders", async t => {
  const job = { id: "handoff", state: "generating", title: "Ride", activityId: 12, createdAt: "2026-09-26T00:00:00Z", model: "model", variants: 1, error: null };
  const list = deferred<Response>();
  let polls = 0;
  let nextPoll: (() => Promise<void>) | undefined;
  t.mock.method(globalThis, "setTimeout", (callback: () => Promise<void>) => {
    nextPoll = callback;
    return 0 as any;
  });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/poster/jobs") return new Response(JSON.stringify({ jobs: polls++ === 0 ? [job] : [] }));
    assert.equal(url, "/api/posters");
    return list.promise;
  });
  const stop = pollPosterJobs(error => { throw error; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(nextPoll);
    assert.ok(getGenerationState().pending.some(image => image.id === "server:handoff:0"));
    const completion = nextPoll!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(getGenerationState().pending.some(image => image.id === "server:handoff:0"), "keep the placeholder while the list loads");
    list.resolve(new Response(JSON.stringify({ posters: [{ posterId: "handoff-completed", activityId: 12 }] })));
    await completion;
    assert.ok(getArrivedPosters().some(poster => poster.posterId === "handoff-completed"));
    assert.ok(!getGenerationState().pending.some(image => image.id === "server:handoff:0"));
  } finally { stop(); }
});

for (const kind of ["modify", "variant"] as const) {
  test(`${kind} submits a background job and hands its placeholder to server polling`, async t => {
    const { modifyPoster, variantPoster } = await import("../api");
    const { setServerGenerationJobs } = await import("./generationState");
    setServerGenerationJobs([], async () => {}, async () => {});
    const annotation = [[{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }]];
    let submitted: any;
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, `/api/poster/${kind}`);
      submitted = JSON.parse(String(init.body));
      assert.ok(getGenerationState().pending.some(image => image.previousPosterId === "source"));
      return Response.json({ jobs: [{ id: `saved-${kind}`, state: "queued", title: "Saved ride", model: "model", variants: 1,
        activityId: 4, previousPosterId: "source", error: null }] }, { status: 202 });
    });
    const body = { posterId: "source", activityId: 4, title: "Saved ride", request: "Use blue", annotation };
    await (kind === "modify" ? modifyPoster(body) : variantPoster(body));
    assert.equal(typeof submitted.submissionId, "string");
    if (kind === "modify") assert.deepEqual(submitted.annotation, annotation);
    const pending = getGenerationState().pending;
    assert.equal(pending.length, 1, "local submission placeholder is replaced, not duplicated");
    assert.equal(pending[0].id, `server:saved-${kind}:0`);
    assert.equal(pending[0].previousPosterId, "source");
    assert.equal(pending[0].phase, "queued");
    setServerGenerationJobs([], async () => {}, async () => {});
  });
}

test("retrying a lost refinement submission retains its deduplication ID and annotation", async t => {
  const { modifyPoster } = await import("../api");
  const { setServerGenerationJobs } = await import("./generationState");
  setServerGenerationJobs([], async () => {}, async () => {});
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (bodies.length === 1) throw new TypeError("Failed to fetch");
    return Response.json({ jobs: [{ id: "retried-edit", state: "queued", title: "Edit", model: "model", variants: 1, error: null }] });
  });
  const annotation = [[{ x: 0, y: 0 }, { x: 1, y: 1 }]];
  await assert.rejects(modifyPoster({ posterId: "source", request: "Use blue", annotation }), /Failed to fetch/);
  await getGenerationState().failed.find(image => image.previousPosterId === "source")!.retry();
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(getGenerationState().pending.length, 1);
  assert.ok(getGenerationState().pending[0].id.startsWith("server:"));
  setServerGenerationJobs([], async () => {}, async () => {});
});

test("idle gallery stops polling, submissions and retries wake it, and hidden tabs pause until visible", async t => {
  const { submitPosterBatch } = await import("../api");
  const { setServerGenerationJobs } = await import("./generationState");
  setServerGenerationJobs([], async () => {}, async () => {});
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = "visible";
  const win = new EventTarget();
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else delete (globalThis as any).document;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete (globalThis as any).window;
  });
  const timers = new Map<number, () => void>();
  let timerId = 0;
  t.mock.method(globalThis, "setTimeout", (cb: () => void) => { timers.set(++timerId, cb); return timerId as any; });
  t.mock.method(globalThis, "clearTimeout", (id: any) => { timers.delete(id); });
  let jobs: any[] = [];
  let polls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/poster/jobs" && init?.method !== "POST") polls++;
    else if (url === "/api/poster/jobs" || url.endsWith("/retry")) {
      jobs = [{ id: "wake-test", state: "queued", title: "Wake test", model: "model", variants: 1, error: null }];
    } else assert.equal(url, "/api/posters");
    return Response.json(url === "/api/posters" ? { posters: [] } : { jobs });
  });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const stop = pollPosterJobs(error => { throw error; });
  try {
    await flush();
    assert.equal(polls, 1);
    assert.equal(timers.size, 0, "empty gallery must have no poll timer");
    await submitPosterBatch({ submissionId: "wake", jobs: [] });
    await flush();
    assert.equal(polls, 2);
    assert.equal(timers.size, 1, "submission restarts polling");
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(timers.size, 0);
    win.dispatchEvent(new Event("focus"));
    await flush();
    assert.equal(polls, 2, "hidden tabs do not poll on focus");
    doc.visibilityState = "visible";
    jobs = [{ ...jobs[0], state: "failed", error: "Try again" }];
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    assert.equal(polls, 3);
    assert.equal(timers.size, 0, "terminal jobs stop polling");
    await getGenerationState().failed.find(image => image.id === "server:wake-test:0")!.retry();
    await flush();
    assert.equal(polls, 4, "retry wakes idle polling");
    assert.equal(timers.size, 1);
  } finally { stop(); }
  assert.equal(timers.size, 0);
  win.dispatchEvent(new Event("focus"));
  doc.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(polls, 4, "unmount removes refresh listeners");
  setServerGenerationJobs([], async () => {}, async () => {});
});

test("an idle poll in flight cannot erase a newly submitted job or lose its wakeup", async t => {
  const { submitPosterBatch } = await import("../api");
  const { setServerGenerationJobs } = await import("./generationState");
  setServerGenerationJobs([], async () => {}, async () => {});
  const stale = deferred<Response>();
  let polls = 0;
  let nextPoll: (() => Promise<void>) | undefined;
  const job = { id: "racing-submission", state: "queued", title: "New job", model: "model", variants: 1, error: null };
  t.mock.method(globalThis, "setTimeout", (cb: () => Promise<void>) => { nextPoll = cb; return 0 as any; });
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ jobs: [job] });
    return polls++ === 0 ? stale.promise : Response.json({ jobs: [job] });
  });
  const stop = pollPosterJobs(error => { throw error; });
  try {
    await submitPosterBatch({ submissionId: "race", jobs: [] });
    stale.resolve(Response.json({ jobs: [] }));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(getGenerationState().pending.some(image => image.id === "server:racing-submission:0"));
    assert.ok(nextPoll, "submission during a request must schedule another refresh");
    await nextPoll!();
    assert.equal(polls, 2);
    assert.ok(getGenerationState().pending.some(image => image.id === "server:racing-submission:0"));
  } finally { stop(); }
  setServerGenerationJobs([], async () => {}, async () => {});
});
