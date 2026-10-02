import { performance } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import type { TLSSocket } from "node:tls";
import { describeError, type LlmTraceCapture, type LlmTraceKind } from "./llmTrace";

type AttemptContext = { attempt: Record<string, unknown>; started: number };
const requestContext = new AsyncLocalStorage<AttemptContext>();
const requestAttempts = new WeakMap<object, AttemptContext>();

// Associate socket events with the actual request, rather than a pooled
// connection's original async context. Never retain raw request headers.
channel("undici:request:create").subscribe((message) => {
  const { request } = message as { request: object };
  const context = requestContext.getStore();
  if (context && request) requestAttempts.set(request, context);
});
channel("undici:client:sendHeaders").subscribe((message) => {
  const { request, socket } = message as { request: object; socket: TLSSocket };
  const context = requestAttempts.get(request);
  if (!context || !socket) return;
  context.attempt.sentAfterMs = Date.now() - context.started;
  context.attempt.connection = {
    remoteAddress: socket.remoteAddress,
    remotePort: socket.remotePort,
    alpnProtocol: socket.alpnProtocol,
    encrypted: socket.encrypted === true,
  };
});
channel("undici:request:bodySent").subscribe((message) => {
  const { request } = message as { request: object };
  const context = requestAttempts.get(request);
  if (context) context.attempt.requestBodySentAfterMs = Date.now() - context.started;
});

const active = { image: 0, chat: 0 };
const running = new Set<{ peakActiveRequests: number }>();

/** One deadline covers the request and any schema fallback, including body reads. */
export function openRouterTransport(kind: LlmTraceKind, timeoutMs: number, capture: LlmTraceCapture) {
  const controller = new AbortController();
  const started = Date.now();
  const monotonicStarted = performance.now();
  const attempts: Record<string, unknown>[] = [];
  active[kind]++;
  const concurrency = { peakActiveRequests: active.image + active.chat };
  running.add(concurrency);
  for (const request of running) request.peakActiveRequests = Math.max(request.peakActiveRequests, active.image + active.chat);
  const diagnostics: Record<string, unknown> = {
    timeoutMs, attempts, activeAtStart: { ...active }, concurrency,
    runtime: { node: process.version, undici: process.versions.undici },
    maxHeartbeatDelayMs: 0,
  };
  capture({ diagnostics });
  let previousHeartbeat = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    diagnostics.maxHeartbeatDelayMs = Math.max(Number(diagnostics.maxHeartbeatDelayMs), now - previousHeartbeat - 1000);
    previousHeartbeat = now;
  }, 1000);
  heartbeat.unref();
  const timer = setTimeout(() => {
    diagnostics.timeoutFiredAfterMs = Date.now() - started;
    diagnostics.timeoutTimerDelayMs = Math.max(0, Date.now() - started - timeoutMs);
    controller.abort();
  }, timeoutMs);

  return {
    async send(url: string, init: RequestInit) {
      const destination = new URL(url);
      const attempt: Record<string, unknown> = {
        number: attempts.length + 1, phase: "waiting-for-headers", startedAfterMs: Date.now() - started,
        endpoint: `${destination.origin}${destination.pathname}`,
        method: init.method ?? "GET", responseReceived: false,
      };
      if (typeof init.body === "string") attempt.requestBytes = Buffer.byteLength(init.body);
      attempts.push(attempt);
      try {
        const response = await requestContext.run({ attempt, started }, () =>
          fetch(url, { ...init, signal: controller.signal }));
        attempt.responseReceived = true;
        attempt.headersAfterMs = Date.now() - started;
        attempt.status = response.status;
        // Never log authentication/cookie headers. Preserve routing and retry evidence.
        const headers: Record<string, string> = {};
        for (const name of ["x-request-id", "x-openrouter-request-id", "request-id", "cf-ray", "retry-after",
          "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "server-timing", "content-type", "content-length"]) {
          const value = response.headers.get(name);
          if (value !== null) headers[name] = value;
        }
        attempt.headers = headers;
        attempt.phase = "reading-body";
        // Capture status even if the body subsequently stalls or the connection drops.
        capture({ status: response.status, diagnostics });
        const text = await response.text();
        attempt.bodyAfterMs = Date.now() - started;
        attempt.responseBytes = Buffer.byteLength(text);
        attempt.phase = "parsing-body";
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
          attempt.validJson = true;
        } catch {
          attempt.validJson = false;
          parsed = { error: { message: text || `OpenRouter ${response.status}` } };
        }
        if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          if (record.error !== undefined) attempt.providerError = record.error;
          for (const key of ["id", "request_id", "provider", "provider_name"]) {
            if (typeof record[key] === "string") attempt[key] = record[key];
          }
        }
        attempt.phase = "complete";
        capture({ response: parsed, diagnostics });
        return { response, parsed };
      } catch (error) {
        attempt.error = describeError(error);
        attempt.failedAfterMs = Date.now() - started;
        attempt.abortedByDeadline = controller.signal.aborted;
        attempt.failureLayer = controller.signal.aborted ? "deadline"
          : attempt.responseReceived ? "response-body" : "transport-before-response";
        capture({ diagnostics });
        throw error;
      }
    },
    close() {
      clearTimeout(timer);
      clearInterval(heartbeat);
      running.delete(concurrency);
      active[kind]--;
      const elapsed = Date.now() - started;
      diagnostics.elapsedMs = elapsed;
      diagnostics.monotonicElapsedMs = Math.round(performance.now() - monotonicStarted);
      diagnostics.maxHeartbeatDelayMs = Math.max(Number(diagnostics.maxHeartbeatDelayMs), Date.now() - previousHeartbeat - 1000, 0);
      diagnostics.deadlineExceededByMs = Math.max(0, elapsed - timeoutMs);
      diagnostics.activeAtFinish = { ...active };
      capture({ diagnostics });
    },
  };
}
