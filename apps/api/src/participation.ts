import type { Context, Next } from "hono";
import { query, queryOne, withTransaction, type SqlClient } from "./db";

export const ELIGIBILITY_VERSION = "age-13-plus-v1";
export type PolicyConfig = { termsVersion: string | null; aiVersion: string | null; termsUrl: string | null; privacyUrl: string | null };
export type Participation = PolicyConfig & { eligible: boolean; blocked: boolean; termsAccepted: boolean; aiConsented: boolean; ready: boolean };
export function policyConfig(): PolicyConfig {
  const route = (value?: string) => value && /^\/(?!\/)[\w/-]+$/.test(value.trim()) ? value.trim() : null;
  return { termsVersion: process.env.TERMS_VERSION?.trim() || null, aiVersion: process.env.AI_CONSENT_VERSION?.trim() || null,
    termsUrl: route(process.env.TERMS_ROUTE), privacyUrl: route(process.env.PRIVACY_ROUTE) };
}
export async function participationStatus(userId: string, config = policyConfig(), client?: SqlClient): Promise<Participation> {
  const user = await queryOne<{ eligibility_blocked: boolean }>('SELECT eligibility_blocked FROM "user" WHERE id = $1', [userId], client);
  const rows = await query<{ kind: string; version: string; accepted: boolean }>(
    `SELECT DISTINCT ON (kind) kind, version, accepted FROM participation_events WHERE user_id = $1 ORDER BY kind, id DESC`, [userId], client);
  const accepted = (kind: string, version: string | null) => Boolean(version && rows.some(r => r.kind === kind && r.version === version && r.accepted));
  return { ...config, blocked: !user || user.eligibility_blocked, eligible: accepted("eligibility", ELIGIBILITY_VERSION),
    termsAccepted: accepted("terms", config.termsVersion), aiConsented: accepted("ai", config.aiVersion),
    ready: Boolean(config.termsVersion && config.aiVersion && config.termsUrl && config.privacyUrl) };
}
export class ParticipationError extends Error {
  status = 403 as const;
  code = "PARTICIPATION_REQUIRED";
}
export function assertParticipation(status: Participation, ai = false) {
  if (status.blocked) throw new ParticipationError("This account cannot use Scenic Route. Contact info@scenic-route.ca for help or a privacy request.");
  if (!status.ready) throw new ParticipationError("Reviewed policies are not available yet. Please check back later.");
  if (!status.eligible || !status.termsAccepted) throw new ParticipationError("Confirm eligibility and accept the current Terms before continuing.");
  if (ai && !status.aiConsented) throw new ParticipationError("AI-processing consent is required before generation or refinement.");
}
export async function requireGenerationConsent(userId: string) { assertParticipation(await participationStatus(userId), true); }
export function recoveryPath(path: string, method: string) {
  return (path === "/api/participation" && ["GET", "POST"].includes(method)) || (path === "/api/account" && method === "DELETE");
}
export function generationPath(path: string, method: string) {
  return method === "POST" && (['/api/poster/generate', '/api/poster/modify', '/api/poster/variant'].includes(path)
    || path === '/api/poster/jobs' || /^\/api\/poster\/jobs\/[^/]+\/retry$/.test(path));
}
export function createParticipationGate(lookup = participationStatus) {
  return async (c: Context, next: Next) => {
    if (recoveryPath(c.req.path, c.req.method)) return next();
    try { assertParticipation(await lookup(c.get("user").id), generationPath(c.req.path, c.req.method)); }
    catch (error) { if (error instanceof ParticipationError) return c.json({ error: error.message, code: error.code }, 403); throw error; }
    return next();
  };
}
export function validateAcceptance(body: unknown, status: Participation): body is { eligible: boolean; terms: boolean; ai: boolean; termsVersion: string; aiVersion: string } {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return status.ready && !status.blocked && typeof b.eligible === "boolean" && typeof b.terms === "boolean" && typeof b.ai === "boolean"
    && b.termsVersion === status.termsVersion && b.aiVersion === status.aiVersion;
}
export async function recordParticipation(userId: string, body: unknown) {
  await withTransaction(async client => {
    // Serialize consent/restriction changes for this account; blocked users cannot self-clear.
    await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [userId]);
    const status = await participationStatus(userId, policyConfig(), client);
    if (!validateAcceptance(body, status)) throw new ParticipationError("Use the current reviewed policies and explicit choices. Restricted accounts must contact info@scenic-route.ca.");
    for (const [kind, version, accepted] of [["eligibility", ELIGIBILITY_VERSION, body.eligible], ["terms", body.termsVersion, body.terms], ["ai", body.aiVersion, body.ai]] as const) {
      await client.query('INSERT INTO participation_events (user_id, kind, version, accepted) VALUES ($1, $2, $3, $4)', [userId, kind, version, accepted]);
    }
    if (!body.eligible) await client.query('UPDATE "user" SET eligibility_blocked = true WHERE id = $1', [userId]);
  });
  return participationStatus(userId);
}

export function authRecoveryPath(path: string) {
  return ["/api/auth/get-session", "/api/auth/sign-out", "/api/auth/sign-in/email", "/api/auth/sign-in/social",
    "/api/auth/sign-up/email", "/api/auth/request-password-reset", "/api/auth/reset-password",
    "/api/auth/verify-email", "/api/auth/send-verification-email", "/api/auth/callback/google"].includes(path);
}
