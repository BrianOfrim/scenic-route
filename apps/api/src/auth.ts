import { configureImageLimits } from "./imageLimits";
import type { Context, Next } from "hono";
import { APIError, betterAuth, type BetterAuthOptions } from "better-auth";
import type pg from "pg";
import { Resend } from "resend";
import { AccountUnavailableError, withAccountAccess } from "./accountLifecycle";
import { providerQueue, RequestQueueError } from "./requestQueue";
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

export function googleSignInEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export async function sendAuthEmail(data: { email: string; url: string }, kind: "verification" | "reset") {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  const subject = kind === "verification" ? "Verify your Scenic Route email" : "Reset your Scenic Route password";
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new APIError("SERVICE_UNAVAILABLE", { message: "Email delivery is unavailable. Please try again later." });
    }
    console.log(`${subject} for ${data.email}: ${data.url}`);
    return;
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from, to: data.email, subject,
    text: `${subject}: ${data.url}`,
  });
  if (result.error) {
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Could not send email. Please try again later." });
  }
}

// Better Auth verifies Google's ID token before saving it on the account.
// Read only the display photo here; this payload is never used to authenticate.
export function googleProfileImage(account: { providerId: string; idToken?: string | null }): string | null {
  if (account.providerId !== "google" || !account.idToken) return null;
  try {
    const profile = JSON.parse(Buffer.from(account.idToken.split(".")[1], "base64url").toString("utf8"));
    if (typeof profile.picture !== "string") return null;
    const url = new URL(profile.picture);
    if (url.protocol !== "https:" || !(url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function authOptions(database: BetterAuthOptions["database"]) {
  return {
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
    databaseHooks: {
      account: {
        create: {
          after: async (account, context) => {
            const image = googleProfileImage(account);
            if (image && context) await context.context.internalAdapter.updateUser(account.userId, { image });
          },
        },
        update: {
          after: async (account, context) => {
            const image = googleProfileImage(account);
            if (image && context) await context.context.internalAdapter.updateUser(account.userId, { image });
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail({ email: user.email, url }, "reset");
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({ email: user.email, url }, "verification");
      },
    },
    socialProviders: googleSignInEnabled() ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      },
    } : {},
  } satisfies BetterAuthOptions;
}

export function createAuth(database: pg.Pool) {
  return betterAuth(authOptions(database));
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

export function createRequireUser(lookup: SessionLookup = (headers) => getSessionUser(headers), bootstrap = maybeBootstrapUser) {
  return async (c: Context, next: Next) => {
    if (isPublicApiPath(c.req.path, c.req.method)) return next();
    const user = await lookup(c.req.raw.headers);
    if (!user) return c.json({ error: "sign in required" }, 401);
    c.set("user", user);
    try {
      if (c.req.path.startsWith("/api/poster/")) await configureImageLimits(user.id);
      const run = () => withAccountAccess(user.id, c.req.path === "/api/account" && c.req.method === "DELETE", async () => {
        await bootstrap(user);
        await next();
      });
      // Match the worker's lock order. Image HTTP waiters must not hold all
      // account-lock connections while workers hold the image scheduler slots.
      const imageRequest = c.req.method === "POST" && /^\/api\/poster\/(generate|modify|variant)$/.test(c.req.path);
      return await (imageRequest ? providerQueue("image").run(run, undefined, user.id) : run());
    } catch (error) {
      if (error instanceof AccountUnavailableError || error instanceof RequestQueueError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  };
}

export const requireUser = createRequireUser();

export function resetAuth() {
  cached = null;
}
