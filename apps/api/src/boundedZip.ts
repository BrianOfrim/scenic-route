import { inflateRawSync, crc32 } from "node:zlib";
import { ImportError } from "./gpx";
import { MAX_ARCHIVE_ENTRIES, MAX_EXPANDED_BYTES, MAX_EXPANDED_TRACK_BYTES } from "./importLimits";

export function safeArchivePath(raw: string): string {
  const path = raw.replace(/\\/g, "/").split("/").filter(part => part !== ".").join("/");
  if (!path || path.includes("\0") || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").includes("..")) {
    throw new ImportError("Archive contains an unsafe file path");
  }
  return path;
}

// Use central-directory sizes for locating data, but enforce actual output limits
// inside zlib. ZIP size metadata alone does not protect against forged bomb headers.
export function readBoundedZip(bytes: Uint8Array, limits = {
  entries: MAX_ARCHIVE_ENTRIES, total: MAX_EXPANDED_BYTES, file: MAX_EXPANDED_TRACK_BYTES,
}): Map<string, Uint8Array> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
      if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    }
    if (end < 0 || end < bytes.length - 65557) throw new Error("Missing ZIP directory");
    const count = view.getUint16(end + 10, true);
    const size = view.getUint32(end + 12, true);
    const offset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
        view.getUint16(end + 8, true) !== count || count === 65535 || offset + size !== end) {
      throw new ImportError("Split and ZIP64 archives are not supported");
    }
    if (count > limits.entries) throw new ImportError("This zip archive contains too many files");
    const files = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    let cursor = offset;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid directory entry");
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const checksum = view.getUint32(cursor + 16, true);
      const compressed = view.getUint32(cursor + 20, true);
      const expanded = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > end || view.getUint16(cursor + 34, true)) throw new Error("Invalid directory entry");
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      const path = safeArchivePath(new TextDecoder("utf-8", { fatal: true }).decode(nameBytes));
      if (seen.has(path)) throw new ImportError("Archive contains duplicate file paths");
      seen.add(path);
      cursor = next;
      if (!/\.(gpx|fit|tcx)(\.gz)?$/i.test(path) && path.split("/").pop()?.toLowerCase() !== "activities.csv") continue;
      if (flags & 1 || ![0, 8].includes(method)) throw new ImportError("Encrypted or unsupported ZIP compression");
      if (expanded > limits.file) throw new ImportError(`${path} is too large to import`);
      if (total + expanded > limits.total) throw new ImportError("This zip archive expands beyond the import limit");
      if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 ||
          view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new Error("Invalid local header");
      const localNameLength = view.getUint16(local + 26, true);
      const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
      if (start + compressed > offset || !Buffer.from(nameBytes).equals(Buffer.from(bytes.subarray(local + 30, local + 30 + localNameLength)))) throw new Error("Invalid file range");
      const payload = bytes.subarray(start, start + compressed);
      const cap = Math.min(limits.file, limits.total - total);
      if (cap <= 0) throw new ImportError("This zip archive expands beyond the import limit");
      let data: Uint8Array;
      try {
        data = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: cap });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new ImportError("This zip archive expands beyond the import limit");
        throw error;
      }
      if (data.length > cap) throw new ImportError("This zip archive expands beyond the import limit");
      if (data.length !== expanded || crc32(data) !== checksum) throw new Error("Invalid ZIP size or checksum");
      total += data.length;
      files.set(path, data);
    }
    if (cursor !== end) throw new Error("Invalid directory size");
    return files;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("Could not read this zip archive");
  }
}
