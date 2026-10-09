import type { Context } from "hono";
import { fetchTile, isTileSource } from "./tiles";
import { TileError } from "./tileCache";

/** Register behind authentication; caller conditionals never become upstream headers. */
export function tileHandler(fetcher: typeof fetchTile = fetchTile) {
  return async (c: Context) => {
    const { source, z, x, y } = c.req.param();
    c.header("Cache-Control", "no-store");
    if (!isTileSource(source)) return c.json({ error: "unknown tile source" }, 404);
    try {
      const tile = await fetcher(source, z, x, y.replace(/\.png$/, ""), c.req.header("Referer"));
      const headers = { "content-type": tile.contentType, ...(tile.headers ?? { "cache-control": "public, max-age=86400" }) };
      let notModified = false;
      if (source === "osm") {
        const etag = tile.headers?.etag;
        const match = c.req.header("If-None-Match");
        if (match !== undefined) {
          const tags = match.match(/(?:W\/)?"[^"\r\n]*"|\*/g) ?? [];
          notModified = tags.some(tag => tag === "*" || (etag && tag.replace(/^W\//, "") === etag.replace(/^W\//, "")));
        } else {
          const since = Date.parse(c.req.header("If-Modified-Since") ?? "");
          const modified = Date.parse(tile.headers?.["last-modified"] ?? "");
          notModified = Number.isFinite(since) && Number.isFinite(modified) && modified <= since;
        }
      }
      return new Response(notModified ? null : new Uint8Array(tile.bytes), { status: notModified ? 304 : 200, headers });
    } catch (error) {
      if (error instanceof TileError && error.retryAfter) c.header("Retry-After", String(error.retryAfter));
      return c.json({ error: error instanceof TileError ? error.message : "tile request failed" }, error instanceof TileError ? error.status : 502);
    }
  };
}
