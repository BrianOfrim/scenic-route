import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRequireUser, type AuthUser } from "./auth";
import { createFeedbackHandler, sendFeedbackEmail } from "./feedback";
import { recoveryPath } from "./participation";

const user: AuthUser = { id: "feedback-user", email: "rider@example.com", name: "Rider" };
function setup(send: Parameters<typeof createFeedbackHandler>[0], now?: () => number) {
  const app = new Hono<{ Variables: { user: AuthUser } }>();
  app.use("*", async (c, next) => { c.set("user", user); await next(); });
  app.post("/api/feedback", bodyLimit({ maxSize: 32 * 1024 }), createFeedbackHandler(send, now));
  return (body: unknown) => app.request("/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("feedback requires sign-in and allows the waiting-account recovery path", async () => {
  const app = new Hono();
  app.use("*", createRequireUser(async () => null));
  app.post("/api/feedback", c => c.json({ ok: true }));
  assert.equal((await app.request("/api/feedback", { method: "POST" })).status, 401);
  assert.equal(recoveryPath("/api/feedback", "POST"), true);
  assert.equal(recoveryPath("/api/feedback", "GET"), false);
});

test("valid feedback uses the authenticated identity and trims the message", async () => {
  const received: unknown[] = [];
  const request = setup(async feedback => { received.push(feedback); });
  const response = await request({ message: "  Please add more styles!\n", email: "spoof@example.com" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(received, [{ user, message: "Please add more styles!" }]);
});

test("rejects empty, invalid, and oversized messages before sending", async () => {
  let sends = 0;
  const request = setup(async () => { sends++; });
  for (const body of [null, {}, { message: 123 }, { message: "  \n " }, { message: "x".repeat(5001) }]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal((await request({ message: "x".repeat(40000) })).status, 413);
  assert.equal(sends, 0);
});

test("limits repeated submissions and allows another message after the window", async () => {
  let timestamp = 1000;
  let sends = 0;
  const request = setup(async () => { sends++; }, () => timestamp);
  for (let i = 0; i < 3; i++) assert.equal((await request({ message: "Suggestion" })).status, 200);
  const limited = await request({ message: "Suggestion" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "600");
  assert.equal(sends, 3);
  timestamp += 600000;
  assert.equal((await request({ message: "Suggestion" })).status, 200);
});

test("failed delivery reports an error without claiming success or exposing provider details", async () => {
  const request = setup(async () => { throw new Error("private provider details"); });
  const response = await request({ message: "A suggestion" });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /info@scenic-route.ca/);
  assert.ok(!body.error.includes("private provider details"));
});

test("email goes to Scenic Route with the user's email as reply-to", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM = "Scenic Route <info@scenic-route.ca>";
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "test-email" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await sendFeedbackEmail({ user, message: "<script>plain text suggestion</script>" });
    assert.equal(payload?.to, "info@scenic-route.ca");
    assert.equal(payload?.reply_to, user.email);
    assert.match(String(payload?.text), /plain text suggestion/);
    assert.equal(payload?.html, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
});
