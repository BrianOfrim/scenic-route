import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createOverpassClient } from "./overpass";

function cacheDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-osm-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("France is preferred, Germany is the fallback, and OVERPASS_URL overrides both", async (t) => {
  const original = process.env.OVERPASS_URL;
  t.after(() => {
    if (original === undefined) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = original;
  });
  delete process.env.OVERPASS_URL;
  const urls: string[] = [];
  let failFrance = false;
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async (url) => {
    urls.push(String(url));
    if (failFrance && String(url).includes("openstreetmap.fr")) {
      return new Response("unavailable", { status: 504 });
    }
    return Response.json({ elements: [] });
  } });
  await client("preferred");
  assert.deepEqual(urls, ["https://overpass.openstreetmap.fr/api/interpreter"]);
  urls.length = 0;
  failFrance = true;
  await client("fallback");
  assert.deepEqual(urls, [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ]);
  urls.length = 0;
  process.env.OVERPASS_URL = "https://example.test/api/interpreter";
  await client("override");
  assert.deepEqual(urls, ["https://example.test/api/interpreter"]);
});

test("a successful empty result stops endpoint fallback and survives a fresh client", async (t) => {
  const dir = cacheDir(t);
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json({ elements: [] });
  };
  const query = "empty";
  const first = createOverpassClient({ cacheDir: dir, fetch: transport });
  assert.deepEqual(await first(query), { elements: [] });
  const second = createOverpassClient({ cacheDir: dir, fetch: transport });
  assert.deepEqual(await second(query), { elements: [] });
  assert.equal(calls, 1);
});

test("concurrent identical queries share one request; different queries remain separate", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async () => {
    calls++;
    await gate;
    return Response.json({ elements: [{ type: "node", id: 1 }] });
  } });
  const first = client("same");
  const second = client("same");
  const different = client("different");
  assert.equal(first, second);
  assert.equal(calls, 2);
  release();
  await Promise.all([first, second, different]);
});

test("partial, malformed and failed responses are never cached and failures can retry", async (t) => {
  for (const payload of [
    { elements: [{ type: "node", id: 1 }], remark: "runtime error: Query timed out" },
    { remark: "runtime error: Query timed out" },
    {},
    null,
  ]) {
    const dir = cacheDir(t);
    let fail = true;
    const client = createOverpassClient({ cacheDir: dir, fetch: async () => Response.json(fail ? payload : { elements: [] }) });
    await assert.rejects(client("query"), /Overpass remark|Invalid Overpass response/);
    assert.deepEqual(fs.readdirSync(dir), []);
    fail = false;
    assert.deepEqual(await client("query"), { elements: [] });
  }
  const dir = cacheDir(t);
  const client = createOverpassClient({ cacheDir: dir, fetch: async () => new Response("invalid query", { status: 400 }) });
  await assert.rejects(client("bad"), /HTTP 400/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("expired, corrupt and legacy partial cache entries are refetched", async (t) => {
  const dir = cacheDir(t);
  let calls = 0;
  const client = createOverpassClient({ cacheDir: dir, fetch: async () => {
    calls++;
    return Response.json({ elements: [] });
  } });
  for (const query of ["expired", "corrupt", "partial"]) {
    const file = path.join(dir, `${createHash("sha1").update(query).digest("hex")}.json`);
    fs.writeFileSync(file, query === "corrupt" ? "{" : JSON.stringify({
      elements: [{ type: "node", id: 1 }],
      ...(query === "partial" ? { remark: "runtime error" } : {}),
    }));
    if (query === "expired") fs.utimesSync(file, new Date(0), new Date(0));
    assert.deepEqual(await client(query), { elements: [] });
  }
  assert.equal(calls, 3);
});
