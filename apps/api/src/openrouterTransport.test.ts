import assert from "node:assert/strict";
import { test } from "node:test";
import { channel } from "node:diagnostics_channel";
import { openRouterTransport } from "./openrouterTransport";
import type { LlmTraceCapture } from "./llmTrace";

function recording() {
  const info: Parameters<LlmTraceCapture>[0] = {};
  return { info, capture: ((next) => Object.assign(info, next)) as LlmTraceCapture };
}

test("HTTP failures retain routing/rate-limit headers and provider body without secret headers", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    error: { code: 429, metadata: { provider_name: "Example", provider_code: 429 } },
  }), { status: 429, headers: {
    "retry-after": "10", "x-request-id": "provider-request", "x-ratelimit-remaining": "0",
    "set-cookie": "secret", authorization: "secret",
  } }));
  const { info, capture } = recording();
  const transport = openRouterTransport("image", 1000, capture);
  try { await transport.send("https://example.invalid", {}); }
  finally { transport.close(); }
  assert.equal(info.status, 429);
  assert.equal((info.response as any).error.metadata.provider_code, 429);
  const attempt = (info.diagnostics!.attempts as any[])[0];
  assert.equal(attempt.headers["retry-after"], "10");
  assert.equal(attempt.headers["x-request-id"], "provider-request");
  assert.equal(attempt.headers.authorization, undefined);
  assert.equal(attempt.headers["set-cookie"], undefined);
  assert.equal(attempt.phase, "complete");
});

test("a stalled response body preserves HTTP status and records which phase timed out", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
    status: 200, headers: new Headers({ "x-request-id": "body-stalled" }),
    text: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  } as Response));
  const { info, capture } = recording();
  const transport = openRouterTransport("image", 20, capture);
  try { await assert.rejects(transport.send("https://example.invalid", {}), { name: "AbortError" }); }
  finally { transport.close(); }
  assert.equal(info.status, 200);
  const attempt = (info.diagnostics!.attempts as any[])[0];
  assert.equal(attempt.phase, "reading-body");
  assert.equal(attempt.abortedByDeadline, true);
  assert.equal(attempt.headers["x-request-id"], "body-stalled");
  assert.ok(Number(info.diagnostics!.timeoutFiredAfterMs) >= 20);
  assert.ok(Number(info.diagnostics!.timeoutTimerDelayMs) >= 0);
});

test("transport failures preserve nested socket causes and overlapping request counts", async (t) => {
  const cause = Object.assign(new Error("socket closed"), { code: "ECONNRESET", syscall: "read" });
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed", { cause }); });
  const a = recording(), b = recording();
  const first = openRouterTransport("image", 1000, a.capture);
  const second = openRouterTransport("image", 1000, b.capture);
  try { await assert.rejects(first.send("https://example.invalid", {}), /fetch failed/); }
  finally { first.close(); second.close(); }
  const attempt = (a.info.diagnostics!.attempts as any[])[0];
  assert.equal(attempt.phase, "waiting-for-headers");
  assert.equal(attempt.error.cause.code, "ECONNRESET");
  assert.equal(attempt.abortedByDeadline, false);
  assert.equal((a.info.diagnostics!.concurrency as any).peakActiveRequests, 2);
  assert.deepEqual(b.info.diagnostics!.activeAtFinish, { image: 0, chat: 0 });
});

test("schema fallback attempts retain both HTTP responses", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: ++calls === 1 ? 400 : 200 }));
  const { info, capture } = recording();
  const transport = openRouterTransport("chat", 1000, capture);
  try {
    await transport.send("https://example.invalid", {});
    await transport.send("https://example.invalid", {});
  } finally { transport.close(); }
  assert.deepEqual((info.diagnostics!.attempts as any[]).map(item => item.status), [400, 200]);
});

test("connection diagnostics correlate concurrent requests and omit credentials", async (t) => {
  const pending: Array<() => void> = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const request = {};
    channel("undici:request:create").publish({ request });
    await new Promise<void>(resolve => pending.push(resolve));
    channel("undici:client:sendHeaders").publish({ request, headers: "Authorization: secret", socket: {
      remoteAddress: url.includes("one") ? "192.0.2.1" : "192.0.2.2",
      remotePort: 443, alpnProtocol: "h2", encrypted: true,
    } });
    channel("undici:request:bodySent").publish({ request });
    throw new TypeError("fetch failed");
  });
  const a = recording(), b = recording();
  const first = openRouterTransport("chat", 1000, a.capture);
  const second = openRouterTransport("chat", 1000, b.capture);
  try {
    const one = assert.rejects(first.send("https://user:secret@example.invalid/one?key=secret", { method: "POST" }));
    const two = assert.rejects(second.send("https://example.invalid/two", { method: "POST" }));
    pending[1]();
    pending[0]();
    await Promise.all([one, two]);
  } finally { first.close(); second.close(); }
  const one = (a.info.diagnostics!.attempts as any[])[0];
  const two = (b.info.diagnostics!.attempts as any[])[0];
  assert.equal(one.endpoint, "https://example.invalid/one");
  assert.equal(one.method, "POST");
  assert.equal(one.connection.remoteAddress, "192.0.2.1");
  assert.equal(two.connection.remoteAddress, "192.0.2.2");
  assert.equal(one.connection.alpnProtocol, "h2");
  assert.equal(one.responseReceived, false);
  assert.equal(one.failureLayer, "transport-before-response");
  assert.equal(typeof one.requestBodySentAfterMs, "number");
  assert.doesNotMatch(JSON.stringify(a.info.diagnostics), /secret|Authorization/);
});
