import { ImportError } from "./gpx";
import type { ImportFile } from "./importActivity";

import { MAX_IMPORT_FILES, MAX_TRACK_BYTES, MAX_ZIP_BYTES, MAX_REQUEST_BYTES } from "./importLimits";
export { MAX_IMPORT_FILES, MAX_TRACK_BYTES, MAX_ZIP_BYTES } from "./importLimits";

export class ImportBodyLimitError extends ImportError {
  constructor() { super("Upload request is too large (maximum 350 MiB)"); }
}

// Bound bytes before JSON/multipart parsing, even for chunked or dishonest uploads.
export async function boundedImportRequest(request: Request, limit = MAX_REQUEST_BYTES, timeoutMs = 300_000): Promise<Request> {
  if (Number(request.headers.get("content-length")) > limit) {
    await request.body?.cancel();
    throw new ImportBodyLimitError();
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, timeoutMs);
    try {
      while (true) {
        const part = await reader.read();
        if (timedOut) throw new ImportError("Upload timed out; retry with a faster connection or smaller batch");
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ImportBodyLimitError();
        }
        chunks.push(part.value);
      }
    } finally { clearTimeout(timer); reader.releaseLock(); }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

const FORM_KEYS = ["file", "files", "gpx", "fit", "zip"] as const;

export type ImportParseError = { filename: string; error: string };

export type ParsedUploads = {
  files: ImportFile[];
  errors: ImportParseError[];
};

export async function filesFromRequest(request: Request): Promise<ParsedUploads> {
  request = await boundedImportRequest(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return filesFromJsonBody(await request.json());
  }
  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return filesFromForm(await request.formData());
  }
  return { files: [], errors: [] };
}

export function filesFromJsonBody(body: unknown): ParsedUploads {
  const items = Array.isArray(body) ? body : body == null ? [] : [body];
  const files: ImportFile[] = [];
  const errors: ImportParseError[] = [];
  if (items.length > MAX_IMPORT_FILES) {
    errors.push({ filename: jsonFilename(items[MAX_IMPORT_FILES], MAX_IMPORT_FILES), error: fileLimitMessage() });
  }
  items.slice(0, MAX_IMPORT_FILES).forEach((item, index) => {
    try {
      files.push(bytesFromJson(item, index));
    } catch (error) {
      errors.push({
        filename: jsonFilename(item, index),
        error: error instanceof Error ? error.message : "import failed",
      });
    }
  });
  return { files, errors };
}

async function filesFromForm(form: FormData): Promise<ParsedUploads> {
  const parts: FormDataEntryValue[] = [];
  for (const key of FORM_KEYS) parts.push(...form.getAll(key));
  const files: ImportFile[] = [];
  const errors: ImportParseError[] = [];
  if (parts.length > MAX_IMPORT_FILES) {
    errors.push({ filename: formName(parts[MAX_IMPORT_FILES]), error: fileLimitMessage() });
  }
  for (const value of parts.slice(0, MAX_IMPORT_FILES)) {
    if (typeof value === "string") {
      const filename = "upload.gpx";
      const bytes = new TextEncoder().encode(value);
      const problem = sizeProblem(filename, bytes.byteLength);
      if (problem) errors.push({ filename, error: problem });
      else files.push({ filename, bytes });
      continue;
    }
    const filename = value.name || "upload";
    const problem = sizeProblem(filename, value.size);
    if (problem) {
      errors.push({ filename, error: problem });
      continue;
    }
    files.push({ filename, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return { files, errors };
}

function bytesFromJson(item: unknown, index: number): ImportFile {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new ImportError("Invalid import file object");
  const row = item as {
    filename?: string;
    gpx?: string;
    xml?: string;
    content?: string;
    fit?: string;
    zip?: string;
    base64?: string;
  };
  const filename = jsonFilename(item, index);
  const binary = row.fit ?? row.zip ?? row.base64;
  if (typeof binary === "string" && binary.length && !binary.includes("<")) {
    if (binary.length % 4 || /[^A-Za-z0-9+/=]/.test(binary) || !/^[A-Za-z0-9+/]*={0,2}$/.test(binary)) throw new ImportError("Invalid base64 activity file");
    const padding = binary.endsWith("==") ? 2 : binary.endsWith("=") ? 1 : 0;
    const earlyProblem = sizeProblem(filename, binary.length / 4 * 3 - padding);
    if (earlyProblem) throw new ImportError(earlyProblem);
    const decoded = Buffer.from(binary, "base64");
    const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    const problem = sizeProblem(filename, bytes.byteLength);
    if (problem) throw new ImportError(problem);
    return { filename, bytes };
  }
  const text = String(row.gpx ?? row.xml ?? row.content ?? "");
  const bytes = new TextEncoder().encode(text);
  const problem = sizeProblem(filename, bytes.byteLength);
  if (problem) throw new ImportError(problem);
  return { filename, bytes };
}

function jsonFilename(item: unknown, index: number): string {
  const row = (item ?? {}) as { filename?: string };
  return String(row.filename ?? `upload-${index + 1}`);
}

function formName(value: FormDataEntryValue): string {
  return typeof value === "string" ? "upload.gpx" : value.name || "upload";
}

function sizeProblem(filename: string, size: number): string | null {
  const limit = filename.toLowerCase().endsWith(".zip") ? MAX_ZIP_BYTES : MAX_TRACK_BYTES;
  if (size > limit) return `${filename || "File"} is too large`;
  return null;
}

function fileLimitMessage(): string {
  return `Only ${MAX_IMPORT_FILES} files can be imported at once`;
}
