import { alignDataUrlMime } from "./imageMime";
import { withLlmTrace } from "./llmTrace";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
export const KEY_HINT =
  "Set OPENROUTER_API_KEY in .env.local, then restart the API.";

const GENERATE_TIMEOUT_MS = 120_000;
const PLAN_TIMEOUT_MS = 180_000;

export class OpenRouterError extends Error {
  readonly status: 400 | 401 | 502 | 504;
  constructor(message: string, status: 400 | 401 | 502 | 504 = 502) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export function requireKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!key) throw new OpenRouterError(KEY_HINT, 400);
  return key;
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new OpenRouterError(`Set ${name} in .env.local, then restart the API.`, 400);
  return value;
}

export function chatModel() {
  return requireEnv("OPENROUTER_MODEL");
}

export function imageModel() {
  return requireEnv("OPENROUTER_IMAGE_MODEL");
}

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isImageModelId(value: string) {
  return MODEL_ID.test(value.trim());
}

export function resolveImageModel(requested?: string | null) {
  const trimmed = requested?.trim() ?? "";
  return trimmed && isImageModelId(trimmed) ? trimmed : imageModel();
}

export type ImageModelInfo = {
  id: string;
  name: string;
  maxReferences: number;
  maxImages: number;
  /** Empty when the model does not advertise a quality parameter. */
  qualities: string[];
};

export type GeneratedImage = {
  b64: string;
  mediaType: string;
};

export function referer() {
  return process.env.WEB_ORIGIN ?? "http://localhost:5174";
}

function headers(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": referer(),
    "X-Title": "scenic-route",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type JsonResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: true; schema: unknown } };

export function jsonResponseFormat(schemaName: string | undefined, schema: unknown | undefined): JsonResponseFormat {
  if (schema && schemaName) {
    return { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } };
  }
  return { type: "json_object" };
}

/**
 * True when a provider rejected the request because of the structured-output
 * contract itself (unsupported `json_schema`, schema too strict, etc.), as
 * opposed to auth, quota, or transport problems.
 */
export function isSchemaRejection(status: number, payload: unknown): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const message = errorMessage(payload, "").toLowerCase();
  return /response_format|json_schema|structured output|schema|missing '|'required' is required/i.test(
    message,
  );
}

/** Stable non-PII end-user id for OpenRouter abuse isolation and analytics. */
export function openRouterUser(userId?: string | null) {
  const trimmed = userId?.trim() ?? "";
  return trimmed || undefined;
}

export async function chatJson<T>(options: {
  messages: unknown[];
  schemaName?: string;
  schema?: unknown;
  label?: string;
  /** Authenticated app user id (not email). */
  user?: string;
}): Promise<{ value: T; cost: number | null; model: string }> {
  const key = requireKey();
  const model = chatModel();
  const strict = jsonResponseFormat(options.schemaName, options.schema);
  const user = openRouterUser(options.user);
  const request: {
    model: string;
    messages: unknown[];
    response_format: JsonResponseFormat;
    user?: string;
  } = {
    model,
    messages: options.messages,
    response_format: strict,
    ...(user ? { user } : {}),
  };
  return withLlmTrace(
    {
      kind: "chat",
      label: options.label ?? "chat",
      model,
      url: OPENROUTER_CHAT_URL,
      request,
    },
    async (capture) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
      const send = () =>
        fetch(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers: headers(key),
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      try {
        let response = await send();
        let parsed = await readJson(response);
        if (!response.ok && strict.type === "json_schema" && isSchemaRejection(response.status, parsed)) {
          // The provider does not honor strict schemas for this model; fall back to
          // plain JSON mode and rely on the repair pass downstream. The trace keeps
          // the request object by reference, so it records the format actually used.
          console.warn(`[llm:${options.label ?? "chat"}] ${model} rejected json_schema; retrying with json_object`);
          request.response_format = { type: "json_object" };
          response = await send();
          parsed = await readJson(response);
        }
        const record = asRecord(parsed);
        capture({ status: response.status, response: parsed, cost: usageCost(record) });
        if (!response.ok) {
          throw new OpenRouterError(errorMessage(parsed, `OpenRouter ${response.status}`), response.status === 401 ? 401 : 502);
        }
        const choices = Array.isArray(record?.choices) ? record.choices : [];
        const first = asRecord(choices[0]);
        const message = asRecord(first?.message);
        const content = extractContent(message?.content);
        if (!content) throw new OpenRouterError("OpenRouter returned an empty planner response", 502);
        const value = JSON.parse(extractJson(content)) as T;
        const cost = usageCost(record);
        capture({ cost });
        return { value, cost, model };
      } catch (error) {
        if (error instanceof OpenRouterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OpenRouterError("Planner timed out", 504);
        }
        throw new OpenRouterError(error instanceof Error ? error.message : "Planner failed", 502);
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

export async function createImage(options: {
  prompt: string;
  aspectRatio: string;
  references: string[];
  model?: string;
  n?: number;
  quality?: string | null;
  label?: string;
  /** Authenticated app user id (not email). */
  user?: string;
}): Promise<{ images: GeneratedImage[]; cost: number | null }> {
  const key = requireKey();
  const model = resolveImageModel(options.model);
  const n = clampImageCount(options.n);
  const user = openRouterUser(options.user);
  const quality = options.quality?.trim() || undefined;
  const request = {
    model,
    prompt: options.prompt,
    aspect_ratio: options.aspectRatio,
    n,
    ...(quality ? { quality } : {}),
    input_references: options.references.map((url) => ({
      type: "image_url",
      image_url: { url: alignDataUrlMime(url) },
    })),
    ...(user ? { user } : {}),
  };
  return withLlmTrace(
    {
      kind: "image",
      label: options.label ?? "generate",
      model,
      url: OPENROUTER_IMAGES_URL,
      request,
    },
    async (capture) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS * n);
      try {
        const response = await fetch(OPENROUTER_IMAGES_URL, {
          method: "POST",
          headers: headers(key),
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const parsed = await readJson(response);
        const record = asRecord(parsed);
        capture({ status: response.status, response: parsed, cost: usageCost(record) });
        if (!response.ok) {
          throw new OpenRouterError(
            errorMessage(parsed, `OpenRouter image request failed (${response.status})`),
            response.status === 401 ? 401 : 502,
          );
        }
        const image = parseImageResponse(parsed);
        capture({ cost: image.cost });
        return image;
      } catch (error) {
        if (error instanceof OpenRouterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OpenRouterError("Image generation timed out", 504);
        }
        throw new OpenRouterError(error instanceof Error ? error.message : "Image generation failed", 502);
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

export function clampImageCount(value?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function parseImageResponse(payload: unknown): {
  images: GeneratedImage[];
  cost: number | null;
} {
  const record = asRecord(payload);
  if (!record) throw new OpenRouterError("OpenRouter returned an unexpected image payload");
  if (record.error) throw new OpenRouterError(errorMessage(record, "OpenRouter image error"), 502);
  const data = Array.isArray(record.data) ? record.data : [];
  const images: GeneratedImage[] = [];
  for (const item of data) {
    const row = asRecord(item);
    const b64 = row && typeof row.b64_json === "string" ? row.b64_json : "";
    if (!b64) continue;
    images.push({
      b64,
      mediaType: row && typeof row.media_type === "string" && row.media_type ? row.media_type : "image/png",
    });
  }
  if (!images.length) throw new OpenRouterError("OpenRouter did not return image bytes", 502);
  return { images, cost: usageCost(record) };
}

let cachedMaxRefs: { model: string; value: number; at: number } | null = null;
let cachedModels: { value: ImageModelInfo[]; at: number } | null = null;

export async function listImageModels(): Promise<ImageModelInfo[]> {
  if (cachedModels && Date.now() - cachedModels.at < 6 * 60 * 60 * 1000) {
    return cachedModels.value;
  }
  const fallback: ImageModelInfo[] = [
    { id: imageModel(), name: imageModel(), maxReferences: 3, maxImages: 1, qualities: [] },
  ];
  try {
    const key = requireKey();
    const response = await fetch("https://openrouter.ai/api/v1/images/models", {
      headers: headers(key),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const models = withDefaultModel(parseImageModels(await response.json()));
    cachedModels = { value: models, at: Date.now() };
    return models;
  } catch {
    return fallback;
  }
}

export function parseImageModels(payload: unknown): ImageModelInfo[] {
  const record = asRecord(payload);
  const data = Array.isArray(record?.data) ? record.data : [];
  const models: ImageModelInfo[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    const row = asRecord(item);
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!isImageModelId(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof row?.name === "string" && row.name.trim() ? row.name.trim() : id;
    models.push({
      id,
      name,
      maxReferences: maxRefsFromModel(row) ?? 3,
      maxImages: maxImagesFromModel(row) ?? 1,
      qualities: qualitiesFromModel(row),
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

export async function maxImageReferences(requested?: string | null): Promise<number> {
  const model = resolveImageModel(requested);
  if (cachedMaxRefs && cachedMaxRefs.model === model && Date.now() - cachedMaxRefs.at < 6 * 60 * 60 * 1000) {
    return cachedMaxRefs.value;
  }
  if (!cachedModels) await listImageModels();
  const listed = listedMaxRefs(model);
  try {
    const key = requireKey();
    const response = await fetch(
      `https://openrouter.ai/api/v1/images/models/${encodeURIComponent(model)}/endpoints`,
      { headers: headers(key), signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as unknown;
    const value = extractMaxRefs(payload) ?? listed ?? 3;
    cachedMaxRefs = { model, value, at: Date.now() };
    return value;
  } catch {
    const value = listed ?? 3;
    cachedMaxRefs = { model, value, at: Date.now() };
    return value;
  }
}

export async function maxImageOutputs(requested?: string | null): Promise<number> {
  const model = resolveImageModel(requested);
  if (!cachedModels) await listImageModels();
  const listed = listedMaxImages(model);
  return listed && listed > 0 ? listed : 1;
}

export function extractMaxRefs(payload: unknown): number | null {
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  const endpoints = Array.isArray(data?.endpoints) ? data.endpoints : Array.isArray(record?.data) ? record.data : [];
  let max: number | null = null;
  for (const item of endpoints) {
    const endpoint = asRecord(item);
    const params = asRecord(endpoint?.supported_parameters) ?? asRecord(endpoint?.parameters);
    const fromParams = maxRefsFromParams(params);
    const candidate = fromParams ?? (Number(endpoint?.max_input_references ?? 0) || 0);
    if (candidate > 0) max = Math.max(max ?? 0, candidate);
  }
  if (typeof data?.max_input_references === "number") {
    max = Math.max(max ?? 0, data.max_input_references);
  }
  return max && max > 0 ? max : null;
}

export function extractMaxImages(payload: unknown): number | null {
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  const endpoints = Array.isArray(data?.endpoints) ? data.endpoints : Array.isArray(record?.data) ? record.data : [];
  let max: number | null = null;
  for (const item of endpoints) {
    const endpoint = asRecord(item);
    const params = asRecord(endpoint?.supported_parameters) ?? asRecord(endpoint?.parameters);
    const candidate = maxImagesFromParams(params);
    if (candidate) max = Math.max(max ?? 0, candidate);
  }
  return max && max > 0 ? max : null;
}

function maxRefsFromModel(row: Record<string, unknown> | null): number | null {
  if (!row) return null;
  const fromParams = maxRefsFromParams(asRecord(row.supported_parameters));
  if (fromParams) return fromParams;
  if (typeof row.max_input_references === "number" && row.max_input_references > 0) {
    return row.max_input_references;
  }
  return null;
}

function maxRefsFromParams(params: Record<string, unknown> | null): number | null {
  if (!params) return null;
  const refs = asRecord(params.input_references) ?? params;
  const candidate = Number(refs.max ?? refs.maximum ?? 0) || 0;
  return candidate > 0 ? candidate : null;
}

function maxImagesFromModel(row: Record<string, unknown> | null): number | null {
  return maxImagesFromParams(asRecord(row?.supported_parameters));
}

function maxImagesFromParams(params: Record<string, unknown> | null): number | null {
  if (!params) return null;
  const n = asRecord(params.n);
  if (n) {
    const candidate = Number(n.max ?? n.maximum ?? 0) || 0;
    return candidate > 0 ? candidate : null;
  }
  const raw = Number(params.n ?? 0) || 0;
  return raw > 0 ? raw : null;
}

function qualitiesFromModel(row: Record<string, unknown> | null): string[] {
  return qualitiesFromParams(asRecord(row?.supported_parameters));
}

function qualitiesFromParams(params: Record<string, unknown> | null): string[] {
  const quality = asRecord(params?.quality);
  const values = quality?.values;
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function withDefaultModel(models: ImageModelInfo[]): ImageModelInfo[] {
  const fallback = imageModel();
  if (models.some((item) => item.id === fallback)) return models;
  return [{ id: fallback, name: fallback, maxReferences: 3, maxImages: 1, qualities: [] }, ...models];
}

function listedMaxRefs(model: string): number | null {
  const listed = cachedModels?.value.find((item) => item.id === model)?.maxReferences;
  return listed && listed > 0 ? listed : null;
}

function listedMaxImages(model: string): number | null {
  const listed = cachedModels?.value.find((item) => item.id === model)?.maxImages;
  return listed && listed > 0 ? listed : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || `OpenRouter ${response.status}` } };
  }
}

function errorMessage(parsed: unknown, fallback: string) {
  const record = asRecord(parsed);
  if (!record) return fallback;
  const nested = asRecord(record.error);
  const rawNested = nested ? asRecord(nested.metadata) : null;
  const providerRaw = typeof rawNested?.raw === "string" ? rawNested.raw : "";
  let providerMessage = "";
  if (providerRaw) {
    try {
      const inner = asRecord(JSON.parse(providerRaw));
      const innerError = asRecord(inner?.error);
      if (typeof innerError?.message === "string") providerMessage = innerError.message;
      else if (typeof inner?.message === "string") providerMessage = inner.message;
    } catch {
      providerMessage = providerRaw;
    }
  }
  const top =
    typeof record.error === "string"
      ? record.error
      : typeof nested?.message === "string"
        ? nested.message
        : fallback;
  // Prefer the provider's concrete message when OpenRouter wraps it as "Provider returned error".
  const preferred =
    providerMessage && /^provider returned error$/i.test(top) ? providerMessage : providerMessage || top;
  return clarifyOpenRouterError(preferred || fallback);
}

/** Rewrite opaque OpenRouter provider errors into actionable app messages. */
export function clarifyOpenRouterError(message: string) {
  const text = message.trim();
  if (!text) return message;
  if (/paid model training|guardrail restrictions and data policy|data policy/i.test(text)) {
    return "OpenRouter blocked this model under your privacy / data-policy settings. Allow the model at https://openrouter.ai/settings/privacy, or set OPENROUTER_MODEL in .env.local to a model your policy allows (for example anthropic/claude-sonnet-4), then restart the API.";
  }
  return text;
}

function usageCost(record: Record<string, unknown> | null): number | null {
  const usage = asRecord(record?.usage);
  return usage && typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : null;
}

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return typeof record?.text === "string" ? record.text : "";
    })
    .join("");
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new OpenRouterError("Planner did not return JSON", 502);
  return candidate.slice(start, end + 1);
}
