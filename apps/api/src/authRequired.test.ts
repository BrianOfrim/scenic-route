import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createRequireUser, isPublicApiPath, sendAuthEmail } from "./auth";

test("public API paths stay open without a session", () => {
  assert.equal(isPublicApiPath("/api/health", "GET"), true);
  assert.equal(isPublicApiPath("/api/auth/sign-in/email", "POST"), true);
  assert.equal(isPublicApiPath("/api/status", "GET"), false);
  assert.equal(isPublicApiPath("/api/tiles/osm/1/2/3", "GET"), false);
  assert.equal(isPublicApiPath("/api/import", "POST"), false);
});

test("protected routes return 401 without a session cookie", async () => {
  const app = new Hono();
  app.use("/api/*", createRequireUser(async () => null));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/status", (c) => c.json({ ok: true }));

  const health = await app.request("/api/health");
  assert.equal(health.status, 200);

  const status = await app.request("/api/status");
  assert.equal(status.status, 401);
  assert.deepEqual(await status.json(), { error: "sign in required" });
});


test("unconfigured development email logs contain no address or authentication URL", async t => {
  const prior = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM, mode: process.env.NODE_ENV };
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    process.env.NODE_ENV = "development";
    await sendAuthEmail({ email: "private-address@example.invalid", url: "https://invalid/?token=private-token-123" }, "reset");
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs.join(""), /private-|token=|https:/);
    assert.match(logs[0], /delivery unconfigured/);
  } finally {
    for (const [key, value] of [["RESEND_API_KEY", prior.key], ["RESEND_FROM", prior.from], ["NODE_ENV", prior.mode]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});
