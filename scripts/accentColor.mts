/** Accent color for a theme sample, matching the landing explorer's swatch sampling. */
import sharp from "sharp";

const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 72;

export function accentFromPixels(data: Buffer, channels: number): [number, number, number] {
  const pixels: { r: number; g: number; b: number; chroma: number }[] = [];
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    pixels.push({ r, g, b, chroma: Math.max(r, g, b) - Math.min(r, g, b) });
  }
  pixels.sort((a, b) => b.chroma - a.chroma);
  const top = pixels.slice(0, Math.max(1, Math.round(pixels.length * 0.03)));
  const sum = top.reduce((acc, pixel) => ({ r: acc.r + pixel.r, g: acc.g + pixel.g, b: acc.b + pixel.b }), { r: 0, g: 0, b: 0 });
  const mean = [sum.r, sum.g, sum.b].map((value) => value / top.length);
  const luma = mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11;
  return mean.map((value) => Math.round(Math.min(255, Math.max(0, luma + (value - luma) * 1.7)))) as [number, number, number];
}

/** Average of the most colorful pixels, pushed away from grey so a swatch reads as a color. */
export async function accentOfFile(file: string): Promise<[number, number, number]> {
  const { data, info } = await sharp(file)
    .rotate()
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return accentFromPixels(data, info.channels);
}
