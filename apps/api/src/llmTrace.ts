import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LLM_TRACES_DIR } from "./paths";

export type LlmTraceKind = "chat" | "image";

export type LlmTrace = {
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
};

export type LlmTraceCapture = (info: {
  status?: number | null;
  response?: unknown;
  cost?: number | null;
}) => void;

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
  const capture: LlmTraceCapture = (info) => {
    if (info.status !== undefined) status = info.status;
    if (info.response !== undefined) response = info.response;
    if (info.cost !== undefined) cost = info.cost;
  };
  try {
    const value = await run(capture);
    ok = true;
    return value;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
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
    });
  }
}

function persistAndPrint(trace: LlmTrace) {
  try {
    fs.mkdirSync(LLM_TRACES_DIR, { recursive: true });
    const file = path.join(LLM_TRACES_DIR, `${trace.id}-${safeLabel(trace.label)}.json`);
    const written: LlmTrace = { ...trace, file };
    fs.writeFileSync(file, `${stringify(written)}\n`);
    console.log(formatLlmTrace(written));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[llm:${trace.label}] failed to write trace: ${message}`);
    console.log(formatLlmTrace(trace));
  }
}

function safeLabel(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "llm";
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
