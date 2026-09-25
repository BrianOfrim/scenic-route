import { ImportError } from "./gpx";
import type { ImportFile } from "./importActivity";

export const MAX_IMPORT_FILES = 256;
export const MAX_TRACK_BYTES = 15 * 1024 * 1024;
export const MAX_ZIP_BYTES = 250 * 1024 * 1024;

const FORM_KEYS = ["file", "files", "gpx", "fit", "zip"] as const;

export type ImportParseError = { filename: string; error: string };

export type ParsedUploads = {
  files: ImportFile[];
  errors: ImportParseError[];
};

export async function filesFromRequest(request: Request): Promise<ParsedUploads> {
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
  items.slice(MAX_IMPORT_FILES).forEach((item, index) => {
    errors.push({
      filename: jsonFilename(item, MAX_IMPORT_FILES + index),
      error: fileLimitMessage(),
    });
  });
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
  for (const value of parts.slice(MAX_IMPORT_FILES)) {
    errors.push({ filename: formName(value), error: fileLimitMessage() });
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
  const row = (item ?? {}) as {
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
    const bytes = Uint8Array.from(Buffer.from(binary, "base64"));
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
