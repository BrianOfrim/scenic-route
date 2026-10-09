import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { TileCache, TileError, OSM_USER_AGENT, type TileCacheOptions } from "./tileCache";

const url = "https://tile.openstreetmap.org/1/0/0.png";
const ref = "https://scenic-route.ca/";
const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "white" } }).png().toBuffer();
const epoch = Date.parse("2026-10-09T00:00:00Z");
type Call = { url: string; headers: Headers; init?: RequestInit };
async function fixture(t: TestContext, responses: Array<(call: Call) => Response | Promise<Response>>, options: Partial<TileCacheOptions> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scenic-tiles-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = epoch;
  const calls: Call[] = [];
  const transport = (async (input, init) => {
    const call = { url: String(input), headers: new Headers(init?.headers), init }; calls.push(call);
    const response = responses.shift(); assert.ok(response, "unexpected upstream request");
    return response(call);
  }) as typeof fetch;
  const config = { dir, now: () => now, fetch: transport, ...options };
  return { dir, calls, cache: new TileCache(config), restart: () => new TileCache(config), advance: (ms: number) => now += ms,
    response: (headers: Record<string, string> = {}, status = 200, body: Buffer = png) => new Response(status === 304 ? null : new Uint8Array(body), { status, headers: { "content-type": "image/png", date: new Date(now).toUTCString(), ...headers } }) };
}

test("fresh tiles are shared across views and persist across restart", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=3600", etag: '"a"' })]);
  const first = await f.cache.get(url, ref);
  f.advance(10_000);
  const next = await f.cache.get(url, ref);
  assert.equal(f.calls.length, 1); assert.deepEqual(first.bytes, next.bytes);
  assert.equal(next.headers?.["cache-control"], "private, max-age=3590, must-revalidate");
  assert.deepEqual((await f.restart().get(url, ref)).bytes, png); assert.equal(f.calls.length, 1);
});

test("expired entries revalidate with both validators and a header-light 304 keeps the bytes", async t => {
  const modified = "Thu, 08 Oct 2026 00:00:00 GMT";
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=10", etag: '"a"', "last-modified": modified }), call => {
    assert.equal(call.headers.get("if-none-match"), '"a"'); assert.equal(call.headers.get("if-modified-since"), modified);
    return f.response({ "cache-control": "max-age=60" }, 304);
  }]);
  await f.cache.get(url, ref); f.advance(11_000);
  const next = await f.cache.get(url, ref); assert.deepEqual(next.bytes, png); assert.equal(next.headers?.etag, '"a"');
  assert.equal(next.headers?.["cache-control"], "private, max-age=60, must-revalidate");
  await f.restart().get(url, ref); assert.equal(f.calls.length, 2);
});

test("changed entries replace the previous representation", async t => {
  const different = await sharp(png).negate().png().toBuffer();
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=1", etag: '"a"' }), () => f.response({ "cache-control": "max-age=100", etag: '"b"' }, 200, different)]);
  await f.cache.get(url, ref); f.advance(2000);
  assert.deepEqual((await f.cache.get(url, ref)).bytes, different);
  assert.equal((await f.restart().get(url, ref)).headers?.etag, '"b"');
});

for (const [headers, seconds] of [
  [{ "cache-control": "s-maxage=30, max-age=60", expires: "Fri, 09 Oct 2026 01:00:00 GMT" }, 30],
  [{ "cache-control": "max-age=60", expires: "Fri, 09 Oct 2026 01:00:00 GMT" }, 60],
  [{ expires: "Fri, 09 Oct 2026 00:02:00 GMT" }, 120],
  [{}, 604800],
  [{ "cache-control": "max-age=60", age: "20" }, 40],
  [{ "cache-control": "max-age=60", date: "Thu, 08 Oct 2026 23:59:30 GMT" }, 30],
] as Array<[Record<string, string>, number]>) test(`freshness and browser expiry: ${JSON.stringify(headers)}`, async t => {
  const f = await fixture(t, [() => f.response(headers)]);
  assert.equal((await f.cache.get(url, ref)).headers?.["cache-control"], `private, max-age=${seconds}, must-revalidate`);
});

for (const cc of ["max-age=bad", "max-age=10, max-age=20", "no-cache", "private, max-age=60", "no-store, max-age=60"]) test(`restrictive/invalid cache control does not become a seven-day fresh entry: ${cc}`, async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": cc }), () => f.response({ "cache-control": cc })]);
  const result = await f.cache.get(url, ref);
  assert.equal(result.headers?.["cache-control"], /private|no-store/.test(cc) ? "no-store" : "private, max-age=0, must-revalidate");
  await f.cache.get(url, ref); assert.equal(f.calls.length, 2);
});

test("Vary mismatches never reuse a fresh representation", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=100", vary: "Referer", etag: '"a"' }), call => {
    assert.equal(call.headers.get("if-none-match"), null);
    return f.response({ "cache-control": "max-age=100", vary: "Referer", etag: '"b"' });
  }]);
  await f.cache.get(url, ref);
  assert.equal((await f.cache.get(url, "https://scenic-route.fly.dev/")).headers?.etag, '"b"');
});

test("simultaneous requests download once without caller-owned cancellation", async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const f = await fixture(t, [async call => { assert.ok(!call.init?.signal?.aborted); await gate; return f.response({ "cache-control": "max-age=60" }); }]);
  const requests = Array.from({ length: 8 }, () => f.cache.get(url, ref));
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  release(); await Promise.all(requests); assert.equal(f.calls.length, 1);
});

test("upstream queue bounds distinct work", async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const f = await fixture(t, [async () => { await gate; return f.response(); }, () => f.response()], { concurrency: 1, maxQueued: 1 });
  const first = f.cache.get(url, ref);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  const second = f.cache.get(url.replace("/0/0", "/1/0"), ref);
  while (!f.cache.stats().queued) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.cache.get(url.replace("/0/0", "/0/1"), ref), /queue is full/);
  release(); await Promise.all([first, second]); assert.equal(f.calls.length, 2);
});

test("upstream failures keep cached entries, do not serve stale, and back off", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=1", etag: '"a"' }), () => new Response("unavailable", { status: 503, headers: { "retry-after": "120" } }), () => f.response({ "cache-control": "max-age=60" }, 304)]);
  await f.cache.get(url, ref); f.advance(2000);
  await assert.rejects(f.cache.get(url, ref), TileError);
  await assert.rejects(f.cache.get(url, ref), (error: unknown) => error instanceof TileError && error.retryAfter === 120);
  assert.equal(f.calls.length, 2); assert.equal((await fs.readdir(f.dir)).filter(name => name.endsWith(".tile")).length, 1);
  f.advance(120_000); await f.cache.get(url, ref); assert.equal(f.calls.length, 3);
});

test("a missing body after conditional dispatch gets one unconditional recovery", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=1", etag: '"a"' }), async () => {
    for (const name of await fs.readdir(f.dir)) await fs.unlink(path.join(f.dir, name));
    return f.response({}, 304);
  }, call => { assert.equal(call.headers.get("if-none-match"), null); return f.response(); }]);
  await f.cache.get(url, ref); f.advance(2000); assert.deepEqual((await f.cache.get(url, ref)).bytes, png); assert.equal(f.calls.length, 3);
});

for (const kind of ["html", "truncated", "oversized", "redirect"]) test(`invalid upstream response is not cached: ${kind}`, async t => {
  const f = await fixture(t, [call => {
    assert.equal(call.init?.redirect, "error");
    if (kind === "redirect") return new Response(null, { status: 302, headers: { location: "https://example.invalid/" } });
    if (kind === "html") return new Response("error", { headers: { "content-type": "text/html" } });
    return f.response({}, 200, kind === "truncated" ? png.subarray(0, -12) : Buffer.alloc(1024 * 1024 + 1));
  }]);
  await assert.rejects(f.cache.get(url, ref), TileError);
  assert.equal((await fs.readdir(f.dir)).filter(name => name.endsWith(".tile")).length, 0);
});

test("protected fallback entries are retained when the cache fills; later misses do not hammer upstream", async t => {
  const f = await fixture(t, [() => f.response()], { maxEntries: 1 });
  await f.cache.get(url, ref);
  await assert.rejects(f.cache.get(url.replace("/0/0", "/1/0"), ref), /cache is full/);
  await assert.rejects(f.cache.get(url.replace("/0/0", "/0/1"), ref), TileError);
  assert.equal(f.calls.length, 1); assert.deepEqual((await f.cache.get(url, ref)).bytes, png);
});

test("expired entries are evicted before fresh entries", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=1" }), () => f.response({ "cache-control": "max-age=60" })], { maxEntries: 1 });
  await f.cache.get(url, ref); f.advance(2000); await f.cache.get(url.replace("/0/0", "/1/0"), ref);
  assert.equal(f.cache.stats().eviction, 1); assert.equal(f.cache.stats().entries, 1);
});

test("restart removes interrupted writes and corrupt entries", async t => {
  const f = await fixture(t, [() => f.response(), () => f.response()]);
  await f.cache.get(url, ref); const [file] = await fs.readdir(f.dir);
  await fs.writeFile(path.join(f.dir, file), "broken");
  await fs.writeFile(path.join(f.dir, `${"a".repeat(64)}.00000000-0000-0000-0000-000000000000.tmp`), "partial");
  await f.restart().get(url, ref); assert.equal(f.calls.length, 2);
  assert.equal((await fs.readdir(f.dir)).length, 1);
});

test("unwritable storage and missing production mounts stop upstream fetching", async t => {
  const f = await fixture(t, []);
  const blocked = path.join(f.dir, "file"); await fs.writeFile(blocked, "not a directory");
  await assert.rejects(new TileCache({ dir: blocked, fetch: (() => { throw new Error("must not fetch"); }) as typeof fetch }).get(url, ref), /storage is unavailable/);
  await assert.rejects(new TileCache({ dir: f.dir, production: true, fetch: (() => { throw new Error("must not fetch"); }) as typeof fetch }).get(url, ref), /storage is unavailable/);
});

test("identity is stable and request headers contain only application identification", async t => {
  const f = await fixture(t, [call => {
    assert.equal(call.headers.get("user-agent"), OSM_USER_AGENT);
    assert.equal(call.headers.get("referer"), ref);
    assert.deepEqual([...call.headers.keys()].sort(), ["accept", "accept-encoding", "referer", "user-agent"]);
    return f.response();
  }]); await f.cache.get(url, ref);
});

test("disk-full write failure preserves fresh hits and stops subsequent misses", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=60" }), () => f.response({ "cache-control": "max-age=60" })]);
  await f.cache.get(url, ref);
  const open = t.mock.method(fs, "open", async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); });
  await assert.rejects(f.cache.get(url.replace("/0/0", "/1/0"), ref), /storage is unavailable/);
  open.mock.restore();
  assert.deepEqual((await f.cache.get(url, ref)).bytes, png);
  await assert.rejects(f.cache.get(url.replace("/0/0", "/0/1"), ref), /storage is unavailable/);
  assert.equal(f.calls.length, 2);
});

test("stale entries beyond retention are removed on restart", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=1" }), () => f.response()]);
  await f.cache.get(url, ref); f.advance(7 * 86_400_000 + 2000);
  assert.deepEqual((await f.restart().get(url, ref)).bytes, png); assert.equal(f.calls.length, 2);
});

test("max-age takes precedence over malformed Expires", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=60", expires: "invalid" })]);
  assert.equal((await f.cache.get(url, ref)).headers?.["cache-control"], "private, max-age=60, must-revalidate");
});

test("huge age values cannot wrap into fresh reuse", async t => {
  const f = await fixture(t, [() => f.response({ "cache-control": "max-age=60", age: "9".repeat(400) }), () => f.response({ "cache-control": "max-age=60" })]);
  assert.equal((await f.cache.get(url, ref)).headers?.["cache-control"], "private, max-age=0, must-revalidate");
  await f.cache.get(url, ref); assert.equal(f.calls.length, 2);
});

test("aborting one HTTP caller does not cancel another caller's shared tile download", async t => {
  const { Hono } = await import("hono");
  const { tileHandler } = await import("./tileRoute");
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const f = await fixture(t, [async call => { await gate; assert.equal(call.init?.signal?.aborted, false); return f.response(); }]);
  const app = new Hono(); app.get("/api/tiles/:source/:z/:x/:y", tileHandler(() => f.cache.get(url, ref)));
  const caller = new AbortController();
  const first = app.fetch(new Request("http://localhost/api/tiles/osm/1/0/0", { signal: caller.signal }));
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  const second = app.fetch(new Request("http://localhost/api/tiles/osm/1/0/0"));
  caller.abort(); release();
  const [, response] = await Promise.all([first, second]); assert.equal(response.status, 200); assert.equal(f.calls.length, 1);
});
