import sharp from "sharp";

/** Long edge for gallery cards (~2x a 180–220px tile). */
export const POSTER_THUMB_MAX_PX = 400;
export const POSTER_THUMB_WEBP_QUALITY = 72;

export async function encodePosterThumb(png: Buffer): Promise<Buffer> {
  return sharp(png)
    .rotate()
    .resize({
      width: POSTER_THUMB_MAX_PX,
      height: POSTER_THUMB_MAX_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: POSTER_THUMB_WEBP_QUALITY })
    .toBuffer();
}
