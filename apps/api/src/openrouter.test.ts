import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { providerQueue, RequestQueueError } from "./requestQueue";
import {
  OpenRouterError,
  chatModel,
  extractMaxImages,
  extractMaxRefs,
  isImageModelId,
  isSchemaRejection,
  jsonResponseFormat,
  openRouterUser,
  parseImageModels,
  parseImageResponse,
  imageModel,
  resolveImageModel,
} from "./openrouter";

test("openRouterUser keeps stable non-empty ids", () => {
  assert.equal(openRouterUser("user_abc"), "user_abc");
  assert.equal(openRouterUser("  user_abc  "), "user_abc");
  assert.equal(openRouterUser(""), undefined);
  assert.equal(openRouterUser("   "), undefined);
  assert.equal(openRouterUser(null), undefined);
  assert.equal(openRouterUser(undefined), undefined);
});

test("jsonResponseFormat prefers strict json_schema when a schema is supplied", () => {
  assert.deepEqual(jsonResponseFormat("poster_spec", { type: "object" }), {
    type: "json_schema",
    json_schema: { name: "poster_spec", strict: true, schema: { type: "object" } },
  });
  assert.deepEqual(jsonResponseFormat(undefined, undefined), { type: "json_object" });
});

test("isSchemaRejection only matches structured-output complaints", () => {
  assert.equal(isSchemaRejection(400, { error: { message: "response_format json_schema is not supported" } }), true);
  assert.equal(isSchemaRejection(400, { error: { message: "Invalid schema for response_format" } }), true);
  assert.equal(
    isSchemaRejection(400, {
      error: {
        message: "Provider returned error",
        metadata: {
          raw: JSON.stringify({
            error: {
              message:
                "'required' is required to be supplied and to be an array including every key in properties. Missing 'finishName'.",
              param: "schema",
              type: "invalid_request_error",
            },
          }),
        },
      },
    }),
    true,
  );
  assert.equal(isSchemaRejection(400, { error: { message: "context length exceeded" } }), false);
  assert.equal(isSchemaRejection(401, { error: { message: "json_schema" } }), false);
  assert.equal(isSchemaRejection(500, { error: { message: "json_schema" } }), false);
});

test("parseImageResponse reads every image and cost", () => {
  const parsed = parseImageResponse({
    data: [
      { b64_json: "aaaa", media_type: "image/png" },
      { b64_json: "bbbb", media_type: "image/jpeg" },
    ],
    usage: { cost: 0.16 },
  });
  assert.deepEqual(
    parsed.images.map((item) => ({ b64: item.b64, mediaType: item.mediaType })),
    [
      { b64: "aaaa", mediaType: "image/png" },
      { b64: "bbbb", mediaType: "image/jpeg" },
    ],
  );
  assert.equal(parsed.cost, 0.16);
});

test("extractMaxRefs reads endpoint metadata", () => {
  assert.equal(
    extractMaxRefs({
      data: { endpoints: [{ supported_parameters: { input_references: { max: 3 } } }] },
    }),
    3,
  );
  assert.equal(extractMaxRefs({ data: { max_input_references: 4 } }), 4);
  assert.equal(extractMaxRefs({}), null);
});

test("extractMaxImages reads n from endpoints", () => {
  assert.equal(
    extractMaxImages({
      data: { endpoints: [{ supported_parameters: { n: { type: "range", min: 1, max: 10 } } }] },
    }),
    10,
  );
  assert.equal(extractMaxImages({ data: { endpoints: [{ supported_parameters: { n: { max: 1 } } }] } }), 1);
  assert.equal(extractMaxImages({}), null);
});

test("parseImageModels reads discovery listing", () => {
  const models = parseImageModels({
    data: [
      { id: "google/gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", supported_parameters: {} },
      {
        id: "openai/gpt-image-2",
        name: "GPT Image 2",
        supported_parameters: { n: { type: "range", min: 1, max: 10 }, input_references: { max: 16 } },
      },
      { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", supported_parameters: { input_references: { max: 8 } } },
      { id: "not-a-model", name: "Skip" },
    ],
  });
  assert.deepEqual(
    models.map((item) => ({ id: item.id, maxReferences: item.maxReferences, maxImages: item.maxImages })),
    [
      { id: "black-forest-labs/flux.2-pro", maxReferences: 8, maxImages: 1 },
      { id: "google/gemini-2.5-flash-image", maxReferences: 3, maxImages: 1 },
      { id: "openai/gpt-image-2", maxReferences: 16, maxImages: 10 },
    ],
  );
});

test("chatModel reads OPENROUTER_MODEL with no hardcoded fallback", () => {
  const previous = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "meta/muse-spark-1.3-contributor";
  try {
    assert.equal(chatModel(), "meta/muse-spark-1.3-contributor");
    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4";
    assert.equal(chatModel(), "anthropic/claude-sonnet-4");
  } finally {
    if (previous == null) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previous;
  }
});

test("chatModel requires OPENROUTER_MODEL", () => {
  const previous = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  try {
    assert.throws(() => chatModel(), OpenRouterError);
  } finally {
    if (previous == null) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previous;
  }
});

test("resolveImageModel prefers a valid request, otherwise OPENROUTER_IMAGE_MODEL", () => {
  assert.equal(isImageModelId("google/gemini-2.5-flash-image"), true);
  assert.equal(isImageModelId("openai/gpt-5-image:free"), true);
  assert.equal(isImageModelId("not-a-model"), false);
  assert.equal(resolveImageModel("google/gemini-3-pro-image-preview"), "google/gemini-3-pro-image-preview");
  const previous = process.env.OPENROUTER_IMAGE_MODEL;
  process.env.OPENROUTER_IMAGE_MODEL = "openai/gpt-image-test";
  try {
    assert.equal(resolveImageModel("nope"), "openai/gpt-image-test");
    assert.equal(resolveImageModel(""), "openai/gpt-image-test");
    assert.equal(resolveImageModel(null), "openai/gpt-image-test");
    assert.equal(resolveImageModel(undefined), "openai/gpt-image-test");
  } finally {
    if (previous == null) delete process.env.OPENROUTER_IMAGE_MODEL;
    else process.env.OPENROUTER_IMAGE_MODEL = previous;
  }
});

test("imageModel requires OPENROUTER_IMAGE_MODEL", () => {
  const previous = process.env.OPENROUTER_IMAGE_MODEL;
  delete process.env.OPENROUTER_IMAGE_MODEL;
  try {
    assert.throws(() => imageModel(), OpenRouterError);
  } finally {
    if (previous == null) delete process.env.OPENROUTER_IMAGE_MODEL;
    else process.env.OPENROUTER_IMAGE_MODEL = previous;
  }
});

const plannerSuccess = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));

function planningClock(t: TestContext) {
  const oldKey = process.env.OPENROUTER_API_KEY, oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_MODEL = "test/planner";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = oldModel;
  });
  const clock = { now: Date.now() };
  t.mock.method(Date, "now", () => clock.now);
  return clock;
}

test("initial queue waiting preserves the full planning budget for retries", async (t) => {
  const { chatJson } = await import("./openrouter");
  const clock = planningClock(t);
  const waits: number[] = [];
  t.mock.method(providerQueue("chat"), "run", async (work: () => Promise<unknown>, waitMs: number) => {
    waits.push(waitMs);
    if (waits.length === 1) clock.now += 230_000;
    return work();
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) {
      clock.now += 30_000;
      return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429, headers: { "retry-after": "0" } });
    }
    return plannerSuccess();
  });
  assert.deepEqual((await chatJson({ messages: [] })).value, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [240_000, 210_000]);
});

test("retry queue waiting consumes the original planning budget without resetting it", async (t) => {
  const { chatJson } = await import("./openrouter");
  const clock = planningClock(t);
  const waits: number[] = [];
  t.mock.method(providerQueue("chat"), "run", async (work: () => Promise<unknown>, waitMs: number) => {
    waits.push(waitMs);
    if (waits.length === 2) clock.now += 210_000;
    return work();
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    clock.now += 30_000;
    return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429, headers: { "retry-after": "0" } });
  });
  await assert.rejects(chatJson({ messages: [] }), (e: any) => e.status === 504 && /deadline exceeded/.test(e.message));
  assert.equal(calls, 1);
  assert.deepEqual(waits, [240_000, 210_000]);
});

test("initial queue expiry fails without sending or retrying a planning request", async (t) => {
  const { chatJson } = await import("./openrouter");
  planningClock(t);
  const admission = t.mock.method(providerQueue("chat"), "run", async (_work: unknown, waitMs: number) => {
    assert.equal(waitMs, 240_000);
    throw new RequestQueueError("Request queue wait timed out; try again later");
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("expired work ran"));
  await assert.rejects(chatJson({ messages: [] }), RequestQueueError);
  assert.equal(admission.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test("planning refuses retry backoff that would exceed the budget after admission", async (t) => {
  const { chatJson } = await import("./openrouter");
  const clock = planningClock(t);
  t.mock.method(providerQueue("chat"), "run", async (work: () => Promise<unknown>) => {
    clock.now += 230_000;
    return work();
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    clock.now += 239_000;
    return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429, headers: { "retry-after": "2" } });
  });
  await assert.rejects(chatJson({ messages: [] }), (e: any) => e.upstreamStatus === 429);
  assert.equal(fetch.mock.callCount(), 1);
});

test("planning recovery shares a three-call budget across inline and schema fallbacks", async (t) => {
  const { chatJson } = await import("./openrouter");
  const oldKey = process.env.OPENROUTER_API_KEY, oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_MODEL = "test/planner";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = oldModel;
  });
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    if (requests.length === 1) return new Response(JSON.stringify({ error: { metadata: { raw: '{"code":"media_url_not_fetchable"}' } } }), { status: 400 });
    if (requests.length === 2) return new Response(JSON.stringify({ error: { message: "json_schema unsupported" } }), { status: 400 });
    return plannerSuccess();
  });
  const result = await chatJson({ messages: ["url"], inlineMessages: async () => ["inline"], schemaName: "test", schema: {} });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1].messages, ["inline"]);
  assert.equal(requests[2].response_format.type, "json_object");
});

test("429 honors Retry-After and stops after three calls; 400 stops immediately", async (t) => {
  const { chatJson } = await import("./openrouter");
  const oldKey = process.env.OPENROUTER_API_KEY, oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_MODEL = "test/planner";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = oldModel;
  });
  let calls = 0, status = 429;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "rejected" } }), { status, headers: { "retry-after": "0" } });
  });
  await assert.rejects(chatJson({ messages: [] }), (e: any) => e.upstreamStatus === 429 && e.retryAfterMs === 0);
  assert.equal(calls, 3);
  calls = 0; status = 400;
  await assert.rejects(chatJson({ messages: [] }), (e: any) => e.upstreamStatus === 400);
  assert.equal(calls, 1);
});

test("retry classification only permits temporary statuses and known network causes", async () => {
  const { isRetryablePlanningError, retryAfterMs } = await import("./openrouter");
  assert.equal(isRetryablePlanningError(new SyntaxError("bad json")), false);
  assert.equal(isRetryablePlanningError(new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } })), true);
  assert.equal(isRetryablePlanningError(new DOMException("timeout", "AbortError")), false);
  assert.equal(retryAfterMs("10"), 10_000);
  assert.equal(retryAfterMs("Thu, 01 Oct 2026 00:00:10 GMT", Date.parse("2026-10-01T00:00:00Z")), 10_000);
});

test("a network interruption retries planning; image failures never retry", async (t) => {
  const { chatJson, createImage } = await import("./openrouter");
  const oldKey = process.env.OPENROUTER_API_KEY, oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_MODEL = "test/planner";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = oldModel;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } });
    return plannerSuccess();
  });
  assert.deepEqual((await chatJson({ messages: [] })).value, { ok: true });
  assert.equal(calls, 2);
  calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "provider failed" } }), { status: 503 });
  });
  await assert.rejects(createImage({ model: "test/image", prompt: "test", references: [], aspectRatio: "1:1" }));
  assert.equal(calls, 1);
});

test("image provider entry point shares eight-per-user admission with gallery work and exceeds four globally", async t => {
  const { createImage } = await import("./openrouter");
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
  });
  const releases: (() => void)[] = [];
  const owners: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    owners.push(JSON.parse(String(init.body)).user);
    await new Promise<void>(resolve => releases.push(resolve));
    return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200 });
  });
  const generate = (user: string) => createImage({ model: "test/image", prompt: "test", references: [], aspectRatio: "1:1", user });
  // Gallery's outer slot must be reused by its provider call. Direct callers
  // go through the same singleton using their authenticated ownership.
  const pending = [providerQueue("image").run(() => generate("image-owner-a"), null, "image-owner-a"),
    ...Array.from({ length: 9 }, () => generate("image-owner-a")),
    ...Array.from({ length: 10 }, () => generate("image-owner-b"))];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(owners.length, 16, "provider no longer has a global eight-request bottleneck");
  assert.equal(owners.filter(owner => owner === "image-owner-a").length, 8);
  assert.equal(owners.filter(owner => owner === "image-owner-b").length, 8);
  while (releases.length) {
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(pending);
  assert.equal(owners.length, 20);
});

for (const scenario of [
  { status: 402, code: 402, source: undefined, expected: "insufficient_credit" },
  { status: 402, code: 402, source: "openrouter_credits", expected: "insufficient_credit" },
  { status: 402, code: 402, source: "openrouter_key_limit", expected: "insufficient_credit" },
  { status: 200, code: 402, source: "openrouter_credits", expected: "insufficient_credit" },
  { status: 503, code: 402, source: "openrouter_credits", expected: "insufficient_credit" },
  { status: 402, code: 402, source: "openrouter_in_flight_budget", expected: "in_flight_budget" },
]) {
  test(`image billing classification: HTTP ${scenario.status}, ${scenario.source || "legacy 402"}`, async t => {
    const { createImage, OpenRouterError, INSUFFICIENT_CREDIT_MESSAGE, PROVIDER_CAPACITY_MESSAGE, isRetryablePlanningError } = await import("./openrouter");
    const oldKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test";
    t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: scenario.code, message: "opaque billing error", metadata: {
        limit_source: scenario.source, remedy_hint: "operator-only billing details",
      } } }), { status: scenario.status, headers: { "retry-after": "1" } });
    });
    await assert.rejects(createImage({ prompt: "test", aspectRatio: "1:1", references: [], model: "test/image", user: "billing-user" }), error => {
      assert.ok(error instanceof OpenRouterError);
      assert.equal(error.status, 503);
      assert.equal(error.upstreamStatus, scenario.status);
      assert.equal(error.providerCode, scenario.expected);
      assert.equal(error.message, scenario.expected === "insufficient_credit" ? INSUFFICIENT_CREDIT_MESSAGE : PROVIDER_CAPACITY_MESSAGE);
      assert.equal(isRetryablePlanningError(error), false);
      return true;
    });
    assert.equal(calls, 1, "billing errors are never automatically retried by the provider layer");
    await providerQueue("image").run(async () => {}, undefined, "billing-user");
  });
}

test("credit-like text in a non-billing error does not misclassify it as depleted balance", async t => {
  const { createImage, OpenRouterError } = await import("./openrouter");
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = oldKey; });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: 503, message: "Insufficient credits in diagnostic text", metadata: {} } }), { status: 503 }));
  await assert.rejects(createImage({ prompt: "test", aspectRatio: "1:1", references: [], model: "test/image" }), error => {
    assert.ok(error instanceof OpenRouterError);
    assert.equal(error.providerCode, undefined);
    assert.equal(error.upstreamStatus, 503);
    return true;
  });
});
