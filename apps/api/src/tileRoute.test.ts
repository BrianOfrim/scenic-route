import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { tileHandler } from "./tileRoute";
import { fetchTile, isTileSource, osmReferer } from "./tiles";
import { TileError } from "./tileCache";
import { createRequireUser } from "./auth";

test("OSM coordinate bounds and source validation reject without network access", async () => {
  assert.equal(isTileSource("constructor"), false); assert.equal(isTileSource("__proto__"), false);
  for (const [z, x, y] of [["20", "0", "0"], ["1", "2", "0"], ["1", "0", "2"], ["0", "-1", "0"], ["1", "999999999999999999999", "0"]]) {
    await assert.rejects(fetchTile("osm", z, x, y), (error: unknown) => error instanceof TileError && error.status === 400);
  }
});

test("Referer validation strips sensitive paths and never invents a referring site", () => {
  const before = process.env.OSM_TILE_ALLOWED_ORIGINS;
  process.env.OSM_TILE_ALLOWED_ORIGINS = "https://scenic-route.ca,https://scenic-route.fly.dev";
  try {
    assert.equal(osmReferer("https://scenic-route.ca/private?route=secret#gps"), "https://scenic-route.ca/");
    for (const value of [undefined, "", "https://scenic-route.ca.attacker.invalid/", "https://user:password@scenic-route.ca/", "http://scenic-route.ca/", "file:///private"]) assert.throws(() => osmReferer(value), TileError);
  } finally { if (before === undefined) delete process.env.OSM_TILE_ALLOWED_ORIGINS; else process.env.OSM_TILE_ALLOWED_ORIGINS = before; }
});

test("OSM disable switch stops fetching before touching storage", async () => {
  const before = process.env.OSM_TILES_ENABLED; process.env.OSM_TILES_ENABLED = "false";
  try { await assert.rejects(fetchTile("osm", "0", "0", "0", "https://scenic-route.ca/"), /disabled/); }
  finally { if (before === undefined) delete process.env.OSM_TILES_ENABLED; else process.env.OSM_TILES_ENABLED = before; }
});

test("tile route remains protected by real anonymous auth middleware", async () => {
  const app = new Hono(); app.use("/api/*", createRequireUser(async () => null));
  app.get("/api/tiles/:source/:z/:x/:y", tileHandler(async () => { throw new Error("must not fetch"); }));
  assert.equal((await app.request("/api/tiles/osm/0/0/0.png")).status, 401);
});

test("downstream validators obey ETag precedence, keep headers on 304, and don't become upstream headers", async () => {
  const app = new Hono(); const calls: unknown[][] = [];
  app.get("/api/tiles/:source/:z/:x/:y", tileHandler(async (...args) => {
    calls.push(args); return { bytes: Buffer.from("fixture"), contentType: "image/png", headers: { "cache-control": "private, max-age=10, must-revalidate", etag: '"a,b"', "last-modified": "Thu, 08 Oct 2026 00:00:00 GMT", age: "0" } };
  }));
  const headers = { Referer: "http://localhost:5174/", Cookie: "secret", Authorization: "secret", "X-Forwarded-For": "private", "Cache-Control": "no-cache", "If-None-Match": 'W/"a,b"' };
  const response = await app.request("/api/tiles/osm/0/0/0.png", { headers });
  assert.equal(response.status, 304); assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "private, max-age=10, must-revalidate");
  assert.deepEqual(calls[0], ["osm", "0", "0", "0", "http://localhost:5174/"]);
  const mismatch = await app.request("/api/tiles/osm/0/0/0", { headers: { "If-None-Match": '"other"', "If-Modified-Since": "Fri, 09 Oct 2026 00:00:00 GMT" } });
  assert.equal(mismatch.status, 200);
  const since = await app.request("/api/tiles/osm/0/0/0", { headers: { "If-Modified-Since": "Fri, 09 Oct 2026 00:00:00 GMT" } });
  assert.equal(since.status, 304);
});

test("unknown source and failed responses are never cached", async () => {
  const app = new Hono(); app.get("/api/tiles/:source/:z/:x/:y", tileHandler(async () => { throw new TileError("unavailable", 503, 120); }));
  const unknown = await app.request("/api/tiles/constructor/0/0/0"); assert.equal(unknown.status, 404); assert.equal(unknown.headers.get("cache-control"), "no-store");
  const error = await app.request("/api/tiles/osm/0/0/0"); assert.equal(error.status, 503); assert.equal(error.headers.get("cache-control"), "no-store"); assert.equal(error.headers.get("retry-after"), "120");
});

test("non-OSM providers retain their downstream cache behavior", async () => {
  const app = new Hono(); app.get("/api/tiles/:source/:z/:x/:y", tileHandler(async () => ({ bytes: Buffer.from("fixture"), contentType: "image/jpeg" })));
  const response = await app.request("/api/tiles/satellite/0/0/0"); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
});

test("the actual API emits origin Referrer-Policy and uncached anonymous tile errors", async () => {
  const { createApiApp } = await import("./index");
  const app = createApiApp(async () => null);
  const response = await app.request("/api/tiles/osm/0/0/0.png");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "origin");
});
