import assert from "node:assert/strict";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { authOptions, googleProfileImage, sendAuthEmail } from "./auth";

function fixture(google = false, mockGoogleVerification = false) {
  const database: Parameters<typeof memoryAdapter>[0] = { user: [], session: [], account: [], verification: [] };
  const options = authOptions(memoryAdapter(database));
  const emails: { kind: string; url: string }[] = [];
  const auth = betterAuth({
    ...options,
    baseURL: "http://localhost:5174",
    secret: "scenic-route-test-secret-at-least-32-characters",
    trustedOrigins: ["http://localhost:5174"],
    logger: { disabled: true },
    socialProviders: google ? { google: { clientId: "test-client-id", clientSecret: "test-client-secret", ...(mockGoogleVerification ? { verifyIdToken: async () => true } : {}) } } : {},
    emailAndPassword: {
      ...options.emailAndPassword,
      sendResetPassword: async ({ url }) => { emails.push({ kind: "reset", url }); },
    },
    emailVerification: {
      ...options.emailVerification,
      sendVerificationEmail: async ({ url }) => { emails.push({ kind: "verification", url }); },
    },
  });
  const post = (path: string, body: unknown) => auth.handler(new Request(`http://localhost:5174/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5174" },
    body: JSON.stringify(body),
  }));
  return { auth, emails, post, database };
}

const credentials = { email: "rider@example.com", password: "long-original-password", callbackURL: "/" };

test("signup requires verification, then passwords work and reset revokes sessions", async () => {
  const { auth, emails, post } = fixture();
  const signup = await post("sign-up/email", { ...credentials, name: "Rider" });
  assert.equal(signup.status, 200);
  assert.equal((await signup.json()).token, null);
  assert.equal(emails[0]?.kind, "verification");

  const unverified = await post("sign-in/email", credentials);
  assert.equal(unverified.status, 403);
  assert.equal((await unverified.json()).code, "EMAIL_NOT_VERIFIED");

  const verification = await auth.handler(new Request(emails[0].url));
  assert.equal(verification.status, 302);
  assert.equal(verification.headers.get("location"), "/");
  assert.ok(verification.headers.get("set-cookie"));

  const incorrect = await post("sign-in/email", { ...credentials, password: "wrong-password" });
  assert.equal(incorrect.status, 401);
  const signin = await post("sign-in/email", credentials);
  assert.equal(signin.status, 200);
  const cookie = signin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const session = () => auth.handler(new Request("http://localhost:5174/api/auth/get-session", { headers: { cookie } }));
  assert.equal((await (await session()).json()).user.email, credentials.email);

  const resetRequest = await post("request-password-reset", { email: credentials.email, redirectTo: "http://localhost:5174/reset-password" });
  assert.equal(resetRequest.status, 200);
  const resetEmail = emails.find((email) => email.kind === "reset")!;
  const callback = await auth.handler(new Request(resetEmail.url));
  assert.equal(callback.status, 302);
  const destination = new URL(callback.headers.get("location")!);
  assert.equal(destination.pathname, "/reset-password");
  const token = destination.searchParams.get("token");
  assert.ok(token);
  const passwordReset = await post("reset-password", { token, newPassword: "long-replacement-password" });
  assert.equal(passwordReset.status, 200);
  assert.equal(await (await session()).json(), null);
  assert.equal((await post("sign-in/email", credentials)).status, 401);
  assert.equal((await post("sign-in/email", { ...credentials, password: "long-replacement-password" })).status, 200);
  assert.equal((await post("reset-password", { token, newPassword: "another-long-password" })).status, 400);
});

test("reset does not disclose unknown emails and rejects invalid tokens and external redirects", async () => {
  const { post, emails } = fixture();
  assert.equal((await post("request-password-reset", { email: "unknown@example.com", redirectTo: "http://localhost:5174/reset-password" })).status, 200);
  assert.equal(emails.length, 0);
  assert.equal((await post("reset-password", { token: "invalid", newPassword: "long-password" })).status, 400);
  assert.equal((await post("request-password-reset", { email: credentials.email, redirectTo: "https://untrusted.example/reset" })).status, 403);
  assert.equal((await post("sign-in/magic-link", { email: credentials.email })).status, 404);
});

test("Google starts OAuth with configured callback and is unavailable without configuration", async () => {
  const enabled = fixture(true);
  const response = await enabled.post("sign-in/social", { provider: "google", callbackURL: "/" });
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:5174/api/auth/callback/google");
  assert.ok(url.searchParams.get("state"));
  const disabled = fixture();
  assert.equal((await disabled.post("sign-in/social", { provider: "google", callbackURL: "/" })).status, 404);
});


test("expired reset links cannot change a password", async () => {
  const { post, auth, database, emails } = fixture();
  await post("sign-up/email", { ...credentials, name: "Rider" });
  await auth.handler(new Request(emails[0].url));
  await post("request-password-reset", { email: credentials.email, redirectTo: "http://localhost:5174/reset-password" });
  const resetEmail = emails.find((email) => email.kind === "reset")!;
  const token = new URL(resetEmail.url).pathname.split("/").at(-1)!;
  for (const verification of database.verification) verification.expiresAt = new Date(0);
  assert.equal((await post("reset-password", { token, newPassword: "replacement-password" })).status, 400);
  assert.equal((await post("sign-in/email", credentials)).status, 200);
});

test("production email delivery fails explicitly when Resend is unconfigured", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM };
  process.env.NODE_ENV = "production";
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  try {
    await assert.rejects(sendAuthEmail({ email: credentials.email, url: "https://example.com/verify" }, "verification"), /Email delivery is unavailable/);
  } finally {
    for (const [key, value] of [["NODE_ENV", previous.nodeEnv], ["RESEND_API_KEY", previous.key], ["RESEND_FROM", previous.from]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});


test("linking and signing in with Google syncs the photo while preserving the app name", async () => {
  const { post, auth, emails } = fixture(true, true);
  await post("sign-up/email", { ...credentials, name: "Custom app name" });
  await auth.handler(new Request(emails[0].url));
  for (const picture of ["https://lh3.googleusercontent.com/test-photo", "https://lh3.googleusercontent.com/updated-photo"]) {
    // Verification is mocked only in this fixture; production still verifies Google's signature.
    const token = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "google-rider", email: credentials.email, email_verified: true, name: "Google name", picture })).toString("base64url")}.test-signature`;
    const login = await post("sign-in/social", { provider: "google", idToken: { token } });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const response = await auth.handler(new Request("http://localhost:5174/api/auth/get-session", { headers: { cookie } }));
    const { user } = await response.json();
    assert.equal(user.image, picture);
    assert.equal(user.name, "Custom app name");
  }
});

test("photo extraction ignores malformed tokens, other providers, and non-Google image URLs", () => {
  const token = (picture: string) => `header.${Buffer.from(JSON.stringify({ picture })).toString("base64url")}.signature`;
  assert.equal(googleProfileImage({ providerId: "google", idToken: "invalid" }), null);
  assert.equal(googleProfileImage({ providerId: "credential", idToken: token("https://lh3.googleusercontent.com/photo") }), null);
  assert.equal(googleProfileImage({ providerId: "google", idToken: token("https://googleusercontent.com.attacker.example/photo") }), null);
  assert.equal(googleProfileImage({ providerId: "google", idToken: token("http://lh3.googleusercontent.com/photo") }), null);
});
