import { accountContext } from "./accountLifecycle";
import { assertSafeUserId } from "./storage";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LLM_TRACES_DIR } from "./paths";

export type LlmTraceKind = "chat" | "image";

export type LlmTrace = {
  userId?: string;
  id: string;
  kind: LlmTraceKind;
  label: string;
  model: string;
  url: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  status: number | null;
  cost: number | null;
  request: unknown;
  response: unknown;
  error: string | null;
  file: string | null;
  lifecycle?: "running" | "finished";
  diagnostics?: Record<string, unknown>;
  errorDetails?: unknown;
};

export type LlmTraceCapture = (info: {
  status?: number | null;
  response?: unknown;
  cost?: number | null;
  diagnostics?: Record<string, unknown>;
}) => void;

/** Keep transport causes (including AggregateError) without copying arbitrary error properties. */
export function describeError(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[cause depth limit]";
  if (!value || typeof value !== "object") return "[redacted]";
  const error = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["name", "code", "errno", "syscall", "port", "status", "upstreamStatus", "providerCode", "retryAfterMs"]) {
    if (typeof error[key] === "string" || typeof error[key] === "number") result[key] = error[key];
  }
  if (error.cause !== undefined) result.cause = describeError(error.cause, depth + 1);
  if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 8).map(item => describeError(item, depth + 1));
  return result;
}

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/;
// Only explicitly recognized operational fields may retain primitive values.
// Unknown fields (including future provider payloads) fail closed.
const SAFE_STRINGS = new Set(["model", "role", "type", "media_type", "phase", "method", "failureLayer", "node", "undici", "code", "syscall"]);
const SAFE_NUMBERS = /^(status|upstreamStatus|providerCode|errno|port|cost|number|chat|image|peakActiveRequests|.*Ms|.*Bytes)$/;
const SAFE_BOOLEANS = new Set(["responseReceived", "validJson", "abortedByDeadline"]);

export function newTraceId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function sanitizeForTrace(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const dataUrl = summarizeDataUrl(value);
    if (dataUrl) return dataUrl;
    if (/^\[data-url [a-zA-Z0-9.+/-]+ \d+ bytes\]$/.test(value)) return value;
    if (key === "name" && /^(Error|TypeError|RangeError|AggregateError|AbortError|TimeoutError|OpenRouterError)$/.test(value)) return value;
    if (key && SAFE_STRINGS.has(key) && /^[a-zA-Z0-9_./:+ -]{1,100}$/.test(value)) return value;
    return "[redacted]";
  }
  if (typeof value === "number") return key && SAFE_NUMBERS.test(key) ? value : "[redacted]";
  if (typeof value === "boolean") return key && SAFE_BOOLEANS.has(key) ? value : "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitizeForTrace(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([nextKey, next]) => [nextKey, sanitizeForTrace(next, nextKey)]));
  }
  return value;
}

/** Log transport evidence, never arbitrary exception messages or properties. */
export function safeErrorForLog(value: unknown): unknown {
  return sanitizeForTrace(describeError(value));
}

function summarizeDataUrl(value: string): string | null {
  const match = DATA_URL_RE.exec(value);
  if (!match) return null;
  const bytes = Buffer.byteLength(match[2], "base64");
  return `[data-url ${match[1]} ${bytes} bytes]`;
}

export function formatLlmTraceConsole(trace: LlmTrace): string {
  const cost = trace.cost == null ? "n/a" : `$${trace.cost}`;
  const status = trace.status == null ? "—" : String(trace.status);
  const result = trace.ok ? "ok" : "error";
  const lines = [
    `[llm:${trace.label}] ${result} ${trace.id}`,
    `[llm:${trace.label}] ${trace.kind} ${trace.model} ${status} ${trace.durationMs}ms cost=${cost}`,
  ];
  if (trace.error) lines.push(`[llm:${trace.label}] error [redacted; see transport codes]`);
  if (!trace.ok && trace.diagnostics) lines.push(`[llm:${trace.label}] diagnostics ${JSON.stringify(sanitizeForTrace(trace.diagnostics))}`);
  if (trace.errorDetails) lines.push(`[llm:${trace.label}] cause ${JSON.stringify(sanitizeForTrace(trace.errorDetails))}`);

  return lines.join("\n");
}

export function formatLlmTrace(trace: LlmTrace): string {
  const cost = trace.cost == null ? "n/a" : `$${trace.cost}`;
  const status = trace.status == null ? "—" : String(trace.status);
  const result = trace.ok ? "ok" : "error";
  const lines = [
    `[llm:${trace.label}] ${result} ${trace.id}`,
    `[llm:${trace.label}] ${trace.kind} ${trace.model} ${status} ${trace.durationMs}ms cost=${cost}`,
    `[llm:${trace.label}] endpoint [redacted]`,
    `[llm:${trace.label}] request`,
    stringify(sanitizeForTrace(trace.request)),
    `[llm:${trace.label}] response`,
    stringify(sanitizeForTrace(trace.response)),
  ];
  if (trace.error) lines.push(`[llm:${trace.label}] error [redacted; see transport codes]`);

  return lines.join("\n");
}

export async function withLlmTrace<T>(
  meta: { kind: LlmTraceKind; label: string; model: string; url: string; request: unknown },
  run: (capture: LlmTraceCapture) => Promise<T>,
): Promise<T> {
  const id = newTraceId();
  const startedAt = new Date();
  let ok = false;
  let status: number | null = null;
  let response: unknown = null;
  let cost: number | null = null;
  let error: string | null = null;
  let errorDetails: unknown;
  let diagnostics: Record<string, unknown> = {};
  // Persist before sending, so a process exit leaves evidence of unfinished work.
  persistAndPrint({ ...meta, id, startedAt: startedAt.toISOString(), durationMs: 0,
    ok: false, status, response, cost, error, file: null, lifecycle: "running",
    request: sanitizeForTrace(meta.request), diagnostics });
  const capture: LlmTraceCapture = (info) => {
    if (info.status !== undefined) status = info.status;
    if (info.response !== undefined) response = info.response;
    if (info.cost !== undefined) cost = info.cost;
    if (info.diagnostics) diagnostics = { ...diagnostics, ...info.diagnostics };
  };
  try {
    const value = await run(capture);
    ok = true;
    return value;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    errorDetails = describeError(err);
    throw err;
  } finally {
    persistAndPrint({
      id,
      kind: meta.kind,
      label: meta.label,
      model: meta.model,
      url: meta.url,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      ok,
      status,
      cost,
      request: sanitizeForTrace(meta.request),
      response: sanitizeForTrace(response),
      error,
      file: null,
      lifecycle: "finished",
      diagnostics: sanitizeForTrace(diagnostics) as Record<string, unknown>,
      errorDetails,
    });
  }
}

function persistAndPrint(trace: LlmTrace) {
  try {
    const userId = accountContext.getStore();
    if (userId) assertSafeUserId(userId);
    const dir = userId ? path.join(LLM_TRACES_DIR, userId) : LLM_TRACES_DIR;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${trace.id}-${safeLabel(trace.label)}.json`);
    const written: LlmTrace = { ...trace, userId, file, url: "[redacted]",
      request: sanitizeForTrace(trace.request), response: sanitizeForTrace(trace.response),
      error: trace.error ? "[redacted]" : null, errorDetails: sanitizeForTrace(trace.errorDetails),
      diagnostics: sanitizeForTrace(trace.diagnostics) as Record<string, unknown> };
    fs.writeFileSync(file, `${stringify(written)}\n`, { mode: 0o600 });
    console.log(trace.lifecycle === "running"
      ? `[llm:${trace.label}] started ${trace.id} ${trace.kind} ${trace.model}`
      : formatLlmTraceConsole(written));
  } catch (err) {
    const message = JSON.stringify(safeErrorForLog(err));
    console.warn(`[llm:${trace.label}] failed to write trace: ${message}`);
    console.log(formatLlmTraceConsole(trace));
  }
}

function safeLabel(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "llm";
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
