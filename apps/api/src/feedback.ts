import type { Context } from "hono";
import { Resend } from "resend";
import type { AuthUser } from "./auth";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_MESSAGES = 3;
type Feedback = { user: AuthUser; message: string };

export async function sendFeedbackEmail({ user, message }: Feedback) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) throw new Error("Email delivery is unavailable");
  const result = await new Resend(apiKey).emails.send({
    from, to: "info@scenic-route.ca", replyTo: user.email,
    subject: "Scenic Route feedback & suggestions",
    text: `Feedback from ${user.name?.trim() || "a Scenic Route user"} (${user.email})\n\n${message}`,
  });
  if (result.error) throw new Error("Email delivery failed");
}

export function createFeedbackHandler(send = sendFeedbackEmail, now = Date.now) {
  const attempts = new Map<string, { count: number; expires: number }>();
  return async (c: Context<{ Variables: { user: AuthUser } }>) => {
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ error: "Enter a feedback message." }, 400); }
    const message = body && typeof body === "object" && "message" in body ? body.message : undefined;
    if (typeof message !== "string" || !message.trim() || message.length > 5000) {
      return c.json({ error: "Enter a message between 1 and 5,000 characters." }, 400);
    }
    const user = c.get("user");
    const timestamp = now();
    for (const [id, entry] of attempts) if (entry.expires <= timestamp) attempts.delete(id);
    const entry = attempts.get(user.id) ?? { count: 0, expires: timestamp + WINDOW_MS };
    if (entry.count >= MAX_MESSAGES) {
      c.header("Retry-After", String(Math.ceil((entry.expires - timestamp) / 1000)));
      return c.json({ error: "You’ve sent several messages. Please wait a few minutes before trying again." }, 429);
    }
    entry.count++;
    attempts.set(user.id, entry);
    try {
      await send({ user, message: message.trim() });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Could not send your feedback. Please try again later or email info@scenic-route.ca directly." }, 503);
    }
  };
}
