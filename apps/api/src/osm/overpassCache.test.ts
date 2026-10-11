import { logger } from "../logger";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { createOverpassClient } from "./overpass";
import { geographyTiming, newGeographyTiming } from "./geographyTiming";

function cacheDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-osm-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function defaultEndpoints(t: TestContext) {
  const previous = process.env.OVERPASS_URL;
  delete process.env.OVERPASS_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = previous;
  });
}

test("repeated endpoint failures trigger cooldown, skip delays, and recover after expiry", async t => {
  defaultEndpoints(t);
  const events: Record<string, any>[] = [];
  t.mock.method(logger, "debug", (scope: string, fields: Record<string, unknown>) => {
    if (scope === "geography.timing") events.push(fields);
  });
  let clock = 1000;
  let primaryHealthy = false;
  const hosts: string[] = [];
  const primary = "overpass.openstreetmap.fr", secondary = "overpass-api.de";
  const client = createOverpassClient({ cacheDir: cacheDir(t), now: () => clock,
    fetch: async url => {
      const host = new URL(String(url)).hostname;
      hosts.push(host);
      if (host === primary && !primaryHealthy) return new Response("gateway timeout", { status: 504 });
      return Response.json({ elements: [] });
    } });
  await geographyTiming.run(newGeographyTiming(), async () => {
    await client("first");
    await client("second");
    await client("third");
    assert.deepEqual(hosts, [primary, secondary, primary, secondary, secondary]);
    const cooled = events.find(event => event.event === "overpass-endpoint-health" && event.endpoint === primary && event.cooldownMs > 0)!;
    assert.equal(cooled.failures, 2);
    assert.equal(cooled.failureRate, 1);
    assert.equal(cooled.averageSuccessMs, null);
    assert.equal(cooled.cooldownMs, 60_000);
    assert.ok(events.some(event => event.event === "overpass-endpoint-skip" && event.endpoint === primary));
    const healthy = events.filter(event => event.event === "overpass-endpoint-health" && event.endpoint === secondary).at(-1)!;
    assert.equal(healthy.successes, 3);
    assert.equal(healthy.failureRate, 0);
    assert.ok(healthy.averageSuccessMs >= 0);
    clock += 60_000;
    primaryHealthy = true;
    await client("recovered");
    assert.equal(hosts.at(-1), primary);
    const recovered = events.filter(event => event.event === "overpass-endpoint-health" && event.endpoint === primary).at(-1)!;
    assert.equal(recovered.cooldownMs, 0);
    assert.equal(recovered.consecutiveFailures, 0);
    assert.equal(recovered.failureRate, 2 / 3);
  });
});

test("when all endpoints cool down only the earliest recovery endpoint is probed", async t => {
  defaultEndpoints(t);
  const hosts: string[] = [];
  let clock = 1000;
  const client = createOverpassClient({ cacheDir: cacheDir(t), now: () => clock,
    fetch: async url => {
      hosts.push(new URL(String(url)).hostname);
      clock++;
      throw new TypeError("fetch failed");
    } });
  await assert.rejects(client("first"), /fetch failed/);
  await assert.rejects(client("second"), /fetch failed/);
  await assert.rejects(client("third"), /fetch failed/);
  assert.deepEqual(hosts, ["overpass.openstreetmap.fr", "overpass-api.de",
    "overpass.openstreetmap.fr", "overpass-api.de", "overpass.openstreetmap.fr"]);
});

test("bad queries and response limits do not cool endpoints; timeouts can fall back", async t => {
  defaultEndpoints(t);
  const hosts: string[] = [];
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async (url, init) => {
    const host = new URL(String(url)).hostname;
    hosts.push(host);
    const query = new URLSearchParams(String(init?.body)).get("data");
    if (query?.startsWith("bad")) return new Response("invalid query", { status: 400 });
    if (query?.startsWith("remark")) return Response.json({ elements: [], remark: "runtime error: Query timed out" });
    if (query?.startsWith("limit")) throw new Error("Overpass response exceeded byte limit");
    if (query === "timeout" && host === "overpass.openstreetmap.fr") throw new DOMException("request timed out", "TimeoutError");
    return Response.json({ elements: [] });
  } });
  for (const query of ["bad1", "bad2", "remark1", "remark2", "limit1", "limit2"]) await assert.rejects(client(query));
  await client("good");
  assert.ok(hosts.every(host => host === "overpass.openstreetmap.fr"));
  await client("timeout");
  assert.deepEqual(hosts.slice(-2), ["overpass.openstreetmap.fr", "overpass-api.de"]);
});

test("a configured single endpoint is still attempted during cooldown and logs only hostname", async t => {
  defaultEndpoints(t);
  process.env.OVERPASS_URL = "https://user:secret@custom.example/api/interpreter?token=private";
  const events: Record<string, any>[] = [];
  t.mock.method(logger, "debug", (scope: string, fields: Record<string, unknown>) => {
    if (scope === "geography.timing") events.push(fields);
  });
  let calls = 0;
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async () => {
    calls++;
    throw new TypeError("fetch failed");
  } });
  await geographyTiming.run(newGeographyTiming(), async () => {
    for (const query of ["first", "second", "third"]) await assert.rejects(client(query), /fetch failed/);
  });
  assert.equal(calls, 3);
  const attempts = events.filter(event => event.event === "overpass-attempt");
  assert.ok(attempts.every(event => event.endpoint === "custom.example"));
  assert.doesNotMatch(JSON.stringify(events), /secret|private|user:/);
});

test("geography logs cache miss duration and failures without enabling OSM_TIMING", async (t) => {
  const events: Record<string, any>[] = [];
  t.mock.method(logger, "debug", (scope: string, fields: Record<string, unknown>) => {
    if (scope === "geography.timing") events.push(fields);
  });
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async (_url, init) => {
    const query = new URLSearchParams(String(init?.body)).get("data");
    return query === "bad" ? new Response("bad query", { status: 400 }) : Response.json({ elements: [] });
  } });
  const context = newGeographyTiming();
  await geographyTiming.run(context, async () => {
    await client("good");
    await client("good");
    await assert.rejects(client("bad"), /HTTP 400/);
  });
  assert.equal(context.cacheMisses, 2);
  assert.equal(context.cacheHits, 1);
  const misses = events.filter(event => event.event === "overpass-miss");
  assert.deepEqual(misses.map(event => event.outcome), ["complete", "failed"]);
  for (const event of misses) {
    assert.equal(event.loadId, context.loadId);
    assert.equal(event.attempts, 1);
    for (const field of ["totalMs", "networkMs", "queueMs", "cacheReadMs", "cacheWriteMs", "retryMs"]) {
      assert.ok(Number.isFinite(event[field]) && event[field] >= 0, field);
    }
    assert.ok(event.totalMs >= event.networkMs + event.queueMs);
  }
  assert.ok(events.some(event => event.event === "overpass-attempt" && event.status === 400));
  const count = events.length;
  await client("outside-geography");
  assert.equal(events.length, count);
});

test("geography timing measures queue waits and records shared in-flight queries", async (t) => {
  const events: Record<string, any>[] = [];
  t.mock.method(logger, "debug", (scope: string, fields: Record<string, unknown>) => {
    if (scope === "geography.timing") events.push(fields);
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async () => {
    calls++;
    await gate;
    return Response.json({ elements: [] });
  } });
  const context = newGeographyTiming();
  await geographyTiming.run(context, async () => {
    const requests = [client("one"), client("two"), client("three"), client("one")];
    assert.equal(calls, 2);
    await new Promise(resolve => setTimeout(resolve, 15));
    release();
    await Promise.all(requests);
  });
  assert.equal(context.cacheMisses, 3);
  assert.equal(context.inFlight, 1);
  assert.equal(calls, 3);
  const attempts = events.filter(event => event.event === "overpass-attempt");
  assert.equal(attempts.length, 3);
  assert.ok(attempts.some(event => event.queueMs >= 10));
});

test("geography miss timing includes retry backoff and failed endpoint attempts", async (t) => {
  const events: Record<string, any>[] = [];
  t.mock.method(logger, "debug", (scope: string, fields: Record<string, unknown>) => {
    if (scope === "geography.timing") events.push(fields);
  });
  // Fail both default endpoints once so the miss must include a retry delay.
  let calls = 0;
  const client = createOverpassClient({ cacheDir: cacheDir(t), fetch: async () => {
    calls++;
    return calls <= 2 ? new Response("unavailable", { status: 503 }) : Response.json({ elements: [] });
  } });
  await geographyTiming.run(newGeographyTiming(), () => client("retry"));
  assert.equal(calls, 3);
  const miss = events.find(event => event.event === "overpass-miss")!;
  assert.equal(miss.outcome, "complete");
  assert.equal(miss.attempts, 3);
  assert.ok(miss.retryMs >= 1400);
  assert.ok(miss.totalMs >= miss.retryMs + miss.queueMs + miss.networkMs);
  assert.ok(events.some(event => event.event === "overpass-retry" && event.status === 503 && event.delayMs === 1500));
});

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
