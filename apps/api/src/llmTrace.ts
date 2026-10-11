import { imageAttemptContext } from "./jobContext";
import { createR2Store, r2Config } from "./storage";
import { queryOne, query } from "./db";
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
  if (!value || typeof value !== "object") return String(value);
  const error = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["name", "message", "code", "errno", "syscall", "address", "port", "status", "upstreamStatus", "providerCode", "retryAfterMs"]) {
    if (typeof error[key] === "string" || typeof error[key] === "number") result[key] = error[key];
  }
  if (error.cause !== undefined) result.cause = describeError(error.cause, depth + 1);
  if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 8).map(item => describeError(item, depth + 1));
  return result;
}

const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/;
const B64_KEYS = /^(b64|b64_json)$/i;

export function newTraceId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function sanitizeForTrace(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const dataUrl = summarizeDataUrl(value);
    if (dataUrl) return dataUrl;
    if (/^https?:\/\//.test(value) && /[?&]X-Amz-Signature=/i.test(value)) {
      // Signed reference URLs grant access to private objects. Keep only the object path.
      return `${value.split("?")[0]}?[signed-url redacted]`;
    }
    if (key && B64_KEYS.test(key) && value.length > 80) {
      return `[base64 ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForTrace(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [nextKey, next] of Object.entries(value)) {
      out[nextKey] = sanitizeForTrace(next, nextKey);
    }
    return out;
  }
  return value;
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
  if (trace.error) lines.push(`[llm:${trace.label}] error ${trace.error}`);
  if (!trace.ok && trace.diagnostics) lines.push(`[llm:${trace.label}] diagnostics ${JSON.stringify(trace.diagnostics)}`);
  if (trace.errorDetails) lines.push(`[llm:${trace.label}] cause ${JSON.stringify(trace.errorDetails)}`);
  if (trace.file) lines.push(`[llm:${trace.label}] wrote ${trace.file}`);
  return lines.join("\n");
}

export function formatLlmTrace(trace: LlmTrace): string {
  const cost = trace.cost == null ? "n/a" : `$${trace.cost}`;
  const status = trace.status == null ? "—" : String(trace.status);
  const result = trace.ok ? "ok" : "error";
  const lines = [
    `[llm:${trace.label}] ${result} ${trace.id}`,
    `[llm:${trace.label}] ${trace.kind} ${trace.model} ${status} ${trace.durationMs}ms cost=${cost}`,
    `[llm:${trace.label}] ${trace.url}`,
    `[llm:${trace.label}] request`,
    stringify(trace.request),
    `[llm:${trace.label}] response`,
    stringify(trace.response),
  ];
  if (trace.error) lines.push(`[llm:${trace.label}] error ${trace.error}`);
  if (trace.file) lines.push(`[llm:${trace.label}] wrote ${trace.file}`);
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
  await persistAndPrint({ ...meta, id, startedAt: startedAt.toISOString(), durationMs: 0,
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
    await persistAndPrint({
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

async function persistAndPrint(trace: LlmTrace) {
  try {
    const userId = accountContext.getStore();
    if (userId) assertSafeUserId(userId);
    const attempt = imageAttemptContext.getStore();
    const remote = r2Config();
    if (attempt || process.env.APP_ROLE === "worker" || process.env.NODE_ENV === "production") {
      if (!remote || !userId) { console.log(`[llm:${trace.label}] ${trace.id} trace storage unavailable`); return; }
      if (attempt) {
        await attempt.check();
        await query("INSERT INTO image_storage_attempts(attempt_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [attempt.id,userId]);
      } else if (!await queryOne('SELECT 1 FROM "user" WHERE id=$1 AND NOT image_deleting', [userId])) return;
      await createR2Store(remote,"traces/").put(userId,`${attempt ? attempt.id + "/" : ""}${trace.id}.json`,Buffer.from(stringify({...trace,userId})),"application/json");
      console.log(`[llm:${trace.label}] ${trace.id} ${trace.lifecycle}`);
      return;
    }
    const dir = userId ? path.join(LLM_TRACES_DIR, userId) : LLM_TRACES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${trace.id}-${safeLabel(trace.label)}.json`);
    const written: LlmTrace = { ...trace, userId, file };
    fs.writeFileSync(file, `${stringify(written)}\n`);
    console.log(trace.lifecycle === "running"
      ? `[llm:${trace.label}] started ${trace.id} ${trace.kind} ${trace.model} wrote ${file}`
      : formatLlmTraceConsole(written));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[llm:${trace.label}] failed to write trace ${trace.id}`);
    // Never fall back to printing private request/response payloads.
  }
}

function safeLabel(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "llm";
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
