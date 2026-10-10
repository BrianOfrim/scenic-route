import sharp from "sharp";

export type EditPoint = { x: number; y: number };
export type EditAnnotation = EditPoint[][];

/** Coordinates refer to the source image, independent of screen size. */
export function validateEditAnnotation(value: unknown): EditAnnotation {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("Invalid edit annotation");
  let total = 0;
  return value.map(stroke => {
    if (!Array.isArray(stroke) || stroke.length < 2 || (total += stroke.length) > 2048) {
      throw new Error("Invalid edit annotation");
    }
    return stroke.map(point => {
      if (!point || typeof point.x !== "number" || typeof point.y !== "number" ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error("Invalid edit annotation");
      return { x: point.x, y: point.y };
    });
  });
}

export async function annotatedPoster(source: Buffer, strokes: EditAnnotation): Promise<Buffer> {
  const { width, height } = await sharp(source).metadata();
  if (!width || !height) throw new Error("Image dimensions unavailable");
  const lineWidth = Math.max(2, width * 0.006);
  const lines = strokes.map(stroke => {
    const points = stroke.map(p => `${p.x * width},${p.y * height}`).join(" ");
    return `<polyline points="${points}" stroke="white" stroke-width="${lineWidth + width * 0.003}"/><polyline points="${points}" stroke="#FF00B8" stroke-width="${lineWidth}"/>`;
  }).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="none" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`);
  return sharp(source).composite([{ input: overlay }]).png().toBuffer();
}
