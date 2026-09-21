import type { Context, Next } from "hono";
import { APIError, betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";
import type pg from "pg";
import { Resend } from "resend";
import { getPool } from "./db";
import { maybeBootstrapUser } from "./bootstrap";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
};

export type SessionLookup = (headers: Headers) => Promise<AuthUser | null>;

const WEB_ORIGIN = process.env.WEB_ORIGIN?.trim() || "http://localhost:5174";

export function authBaseUrl() {
  return process.env.BETTER_AUTH_URL?.trim() || WEB_ORIGIN;
}

export function authSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set");
  }
  return "scenic-route-dev-auth-secret";
}

export function isPublicApiPath(path: string, method: string) {
  if (path === "/api/health") return true;
  if (path.startsWith("/api/auth/")) return true;
  return false;
}

export async function sendMagicLinkEmail(data: { email: string; url: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) {
    console.log(`magic link for ${data.email}: ${data.url}`);
    return;
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: data.email,
    subject: "Sign in to Scenic Route",
    html: `<p>Click to sign in to Scenic Route:</p><p><a href="${data.url}">Sign in</a></p>`,
  });
  if (result.error) {
    throw new APIError("BAD_REQUEST", { message: result.error.message });
  }
}

export function createAuth(database: pg.Pool) {
  return betterAuth({
    secret: authSecret(),
    baseURL: authBaseUrl(),
    basePath: "/api/auth",
    database,
    trustedOrigins: [WEB_ORIGIN, authBaseUrl()].filter(Boolean),
    advanced: {
      useSecureCookies: authBaseUrl().startsWith("https"),
      defaultCookieAttributes: {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail({ email, url });
        },
      }),
    ],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let cached: AuthInstance | null = null;

export async function getAuth() {
  if (!cached) cached = createAuth(await getPool());
  return cached;
}

export async function getSessionUser(headers: Headers): Promise<AuthUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export function createRequireUser(lookup: SessionLookup = (headers) => getSessionUser(headers)) {
  return async (c: Context, next: Next) => {
    if (isPublicApiPath(c.req.path, c.req.method)) return next();
    const user = await lookup(c.req.raw.headers);
    if (!user) return c.json({ error: "sign in required" }, 401);
    c.set("user", user);
    await maybeBootstrapUser(user);
    return next();
  };
}

export const requireUser = createRequireUser();

export function resetAuth() {
  cached = null;
}
