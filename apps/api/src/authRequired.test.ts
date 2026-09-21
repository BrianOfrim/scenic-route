import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createRequireUser, isPublicApiPath } from "./auth";

test("public API paths stay open without a session", () => {
  assert.equal(isPublicApiPath("/api/health", "GET"), true);
  assert.equal(isPublicApiPath("/api/auth/sign-in/magic-link", "POST"), true);
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
