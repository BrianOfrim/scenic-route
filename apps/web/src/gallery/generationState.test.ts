import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePoster } from "../api";
import { getArrivedPosters } from "./arrivedPosters";
import { beginGeneration, clearFailedImage, getGenerationState, trackGeneration } from "./generationState";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("background requests keep independent placeholders through preparation, completion and failure", async (t) => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  const revision = getGenerationState().revision;
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    return new Response(JSON.stringify({ posters: [{ posterId: body.spec.text.title }] }));
  });
  const a = generatePoster({ activityId: 1, spec: { text: { title: "First" } }, variants: 2 }, 2, () => first.promise);
  const b = generatePoster({ activityId: 2, spec: { text: { title: "Second" } } }, 1, () => second.promise);
  assert.equal(getGenerationState().pending.length, 3);
  assert.equal(new Set(getGenerationState().pending.map((image) => image.id)).size, 3);
  assert.equal(bodies.length, 0, "placeholders appear before reference preparation finishes");

  second.resolve(["second reference"]);
  await b;
  assert.deepEqual(getGenerationState().pending.map((image) => image.title), ["First", "First"]);
  assert.equal(bodies[0].activityId, 2);
  assert.deepEqual(bodies[0].references, ["second reference"]);
  assert.equal(getGenerationState().revision, revision + 1);

  const c = generatePoster({ spec: { text: { title: "Third" } } }, 1);
  await c;
  assert.equal(getGenerationState().pending.length, 2, "new work can finish while an older request is pending");
  first.reject(new Error("Could not prepare image"));
  await assert.rejects(a, /Could not prepare image/);
  assert.equal(getGenerationState().pending.length, 0);
  assert.equal(getGenerationState().error, "Could not prepare image");
  assert.equal(getGenerationState().revision, revision + 3);
});


test("a finished image is published while another request in the batch is still running", async (t) => {
  const gate = deferred<void>();
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.spec.text.title === "Second") await gate.promise;
    return new Response(JSON.stringify({ posters: [{ posterId: body.spec.text.title }] }));
  });
  const first = generatePoster({ spec: { text: { title: "First" } } }, 1);
  const second = generatePoster({ spec: { text: { title: "Second" } } }, 1);
  await first;
  assert.ok(getArrivedPosters().some((poster) => poster.posterId === "First"));
  assert.deepEqual(getGenerationState().pending.map((image) => image.title), ["Second"]);
  gate.resolve();
  await second;
  assert.ok(getArrivedPosters().some((poster) => poster.posterId === "Second"));
  assert.equal(getGenerationState().pending.length, 0);
});

test("prompt and image generation share placeholders without duplicating or clearing other tasks", async (t) => {
  const task = beginGeneration({ title: "Full poster", variants: 2 });
  const other = beginGeneration({ title: "Another poster" });
  const ids = getGenerationState().pending.map((image) => image.id);
  assert.equal(ids.length, 3, "all placeholders exist before prompt generation");
  const prompt = deferred<void>();
  const image = deferred<Response>();
  t.mock.method(globalThis, "fetch", () => image.promise);
  const work = (async () => {
    await prompt.promise;
    return generatePoster({ spec: { text: { title: "Full poster" } } }, 2, undefined, task);
  })();
  assert.deepEqual(getGenerationState().pending.map((item) => item.id), ids);
  prompt.resolve();
  await Promise.resolve();
  assert.deepEqual(getGenerationState().pending.map((item) => item.id), ids, "same placeholders persist into image generation");
  image.resolve(new Response(JSON.stringify({ posters: [{ posterId: "completed" }] })));
  await work;
  assert.deepEqual(getGenerationState().pending.map((item) => item.title), ["Another poster"]);
  const revision = getGenerationState().revision;
  task.finish();
  assert.equal(getGenerationState().revision, revision, "completion is idempotent");
  other.finish(new Error("Poster generation failed"));
  assert.equal(getGenerationState().pending.length, 0);
  assert.equal(getGenerationState().error, "Poster generation failed");
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
