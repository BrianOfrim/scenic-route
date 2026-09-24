/** Match a data-URL MIME type to the image bytes. Models reject a mismatch. */

export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  return null;
}

export function imageDataUrl(bytes: Buffer, declared = "image/png") {
  const mime = sniffImageMime(bytes) || declared;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function alignDataUrlMime(url: string): string {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url.trim());
  if (!match) return url;
  const bytes = Buffer.from(match[2], "base64");
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || sniffed === match[1]) return url;
  return `data:${sniffed};base64,${match[2]}`;
}
