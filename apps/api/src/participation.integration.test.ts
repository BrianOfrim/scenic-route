import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { authOptions, createRequireUser } from "./auth";
import { getPool, query } from "./db";
import { withAccountAccess } from "./accountLifecycle";
import { participationStatus, recordParticipation, requireGenerationConsent, ParticipationError } from "./participation";
import { generatePoster, modifyPoster, variantPoster } from "./poster";
import { GenerationJobQueue, type JobInput } from "./generationJobs";
import { RequestQueue } from "./requestQueue";
import type { PosterSpec } from "./posterSpec";

import { useBootstrapFixture } from "./bootstrapFixture.test-support";

useBootstrapFixture();
before(() => {
  process.env.TERMS_VERSION = 'test-reviewed-terms-v1'; process.env.AI_CONSENT_VERSION = 'test-ai-v1';
  process.env.TERMS_ROUTE = '/terms'; process.env.PRIVACY_ROUTE = '/privacy';
  process.env.BOOTSTRAP_EMAIL = 'bootstrap-unrelated@example.com';
});
const choices = (ai = true) => ({ eligible: true, terms: true, ai, termsVersion: process.env.TERMS_VERSION, aiVersion: process.env.AI_CONSENT_VERSION });
async function user() {
  const id = `participation-${randomUUID()}`;
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [id, `${id}@example.com`]); return id;
}
for (const provider of ['email', 'google']) test(`${provider} authenticated new and existing users cannot bypass eligibility/Terms/AI gates`, async () => {
  process.env.TERMS_VERSION = 'test-reviewed-terms-v1'; process.env.AI_CONSENT_VERSION = 'test-ai-v1';
  const database = await getPool(); const options = authOptions(database); let verification = '';
  const auth = betterAuth({ ...options, baseURL: 'http://localhost:5174', logger: { disabled: true },
    emailVerification: { ...options.emailVerification, sendVerificationEmail: async ({ url }) => { verification = url; } },
    socialProviders: { google: { clientId: 'test', clientSecret: 'test', verifyIdToken: async () => true } },
  });
  const email = `flow-${randomUUID()}@example.com`;
  const post = (route: string, body: object) => auth.handler(new Request(`http://localhost:5174/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' }, body: JSON.stringify(body) }));
  let login: Response;
  if (provider === 'email') {
    await post('sign-up/email', { email, password: 'test-password-long', name: 'Rider', callbackURL: '/' });
    await auth.handler(new Request(verification));
    login = await post('sign-in/email', { email, password: 'test-password-long' });
  } else {
    const token = `header.${Buffer.from(JSON.stringify({ sub: randomUUID(), email, email_verified: true, name: 'Google rider' })).toString('base64url')}.signature`;
    login = await post('sign-in/social', { provider: 'google', idToken: { token } });
  }
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) }); assert.ok(session); const id = session.user.id;
  const app = new Hono(); app.use('/api/*', createRequireUser(async headers => (await auth.api.getSession({ headers }))?.user ?? null));
  app.all('/api/*', c => c.json({ ok: true }));
  const request = (path = '/api/activities', method = 'GET') => app.request(path, { method, headers: { cookie } });
  assert.equal((await request()).status, 403);
  assert.equal((await request('/api/participation')).status, 200);
  assert.equal((await request('/api/account', 'DELETE')).status, 200);
  assert.equal((await request('/api/account', 'POST')).status, 403);
  await recordParticipation(id, choices(false));
  assert.equal((await request()).status, 200);
  for (const path of ['/api/poster/generate', '/api/poster/modify', '/api/poster/variant', '/api/poster/jobs', '/api/poster/jobs/job/retry']) assert.equal((await request(path, 'POST')).status, 403);
  await recordParticipation(id, choices()); assert.equal((await request('/api/poster/generate', 'POST')).status, 200);
  process.env.TERMS_VERSION = 'test-reviewed-terms-v2'; assert.equal((await request()).status, 403);
  await assert.rejects(recordParticipation(id, { ...choices(), termsVersion: 'test-reviewed-terms-v1' }), ParticipationError);
  await recordParticipation(id, choices()); assert.equal((await request()).status, 200);
  process.env.AI_CONSENT_VERSION = 'test-ai-v2'; assert.equal((await request()).status, 200); assert.equal((await request('/api/poster/modify', 'POST')).status, 403);
  await recordParticipation(id, { ...choices(), terms: false }); assert.equal((await request()).status, 403);
  await recordParticipation(id, { ...choices(), eligible: false });
  await assert.rejects(recordParticipation(id, choices()), ParticipationError);
  assert.equal((await request()).status, 403); assert.equal((await request('/api/account', 'DELETE')).status, 200);
  const signedOut = await auth.handler(new Request('http://localhost:5174/api/auth/sign-out', {
    method: 'POST', headers: { cookie, Origin: 'http://localhost:5174', 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(signedOut.status, 200);
});
test('server generation services and queued execution recheck revoked consent before input, reference or provider access', async () => {
  const id = await user(); await recordParticipation(id, choices());
  const input: JobInput = { plan: { activity: {}, title: 'Ride', subtitle: '', stats: [], style: { id: 'test', label: 'Test', prompt: 'style' }, aspectRatio: '3:4', geography: [], pois: [], grounding: [], referenceBatchId: 'refs' },
    generate: { activityId: 1, referenceBatchId: 'refs', model: 'test', styleId: 'test', paletteId: 'auto' } };
  const queue = new GenerationJobQueue({ getActivity: async () => ({ id: 1 } as any), resolveReferences: async () => [], maxImageOutputs: async () => 1,
    prepare: () => ({ spec: { finalPrompt: 'test' } as PosterSpec, cost: 0 }), generate: generatePoster }, new RequestQueue(128, Infinity, 240_000, 8, 16), withAccountAccess);
  await queue.submit(id, { submissionId: 'queued-before-refusal', jobs: [input] });
  await recordParticipation(id, choices(false));
  for (const generate of [generatePoster, modifyPoster, variantPoster]) await assert.rejects(generate(id, {} as any), ParticipationError);
  await Promise.all(queue.dispatch()); assert.equal(queue.list(id)[0].state, 'failed'); assert.match(queue.list(id)[0].error!, /consent/);
  queue.retry(id, queue.list(id)[0].id); await Promise.all(queue.dispatch()); assert.equal(queue.list(id)[0].state, 'failed');
  await query('UPDATE "user" SET eligibility_blocked = true WHERE id = $1', [id]);
  await assert.rejects(requireGenerationConsent(id), /cannot use/);
});
test('separate timestamped events survive refusal and cascade on deletion; unconfigured policies fail closed', async () => {
  const id = await user(); await recordParticipation(id, choices()); await recordParticipation(id, choices(false));
  const rows = await query<{ kind: string; accepted: boolean; recorded_at: Date }>('SELECT * FROM participation_events WHERE user_id = $1 ORDER BY id', [id]);
  assert.equal(rows.length, 6); assert.deepEqual(rows.map(r => r.kind), ['eligibility', 'terms', 'ai', 'eligibility', 'terms', 'ai']);
  assert.ok(rows.every(r => r.recorded_at instanceof Date)); assert.equal(rows.at(-1)?.accepted, false);
  const config = { termsVersion: null, aiVersion: null, termsUrl: null, privacyUrl: null };
  assert.equal((await participationStatus(id, config)).ready, false);
  await query('DELETE FROM "user" WHERE id = $1', [id]); assert.equal((await query('SELECT * FROM participation_events WHERE user_id = $1', [id])).length, 0);
});

test('consent mutation waits for active account work and cannot race an upstream request', async () => {
  const id = await user(); await recordParticipation(id, choices());
  let release!: () => void; let acquired!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const running = withAccountAccess(id, false, async () => { acquired(); await hold; });
  await started;
  const app = new Hono(); app.use('/api/*', createRequireUser(async () => ({ id, email: `${id}@example.com` })));
  app.post('/api/participation', async c => c.json(await recordParticipation(id, choices(false))));
  try { assert.equal((await app.request('/api/participation', { method: 'POST' })).status, 409); }
  finally { release(); await running; }
  assert.equal((await participationStatus(id)).aiConsented, true);
  assert.equal((await app.request('/api/participation', { method: 'POST' })).status, 200);
  assert.equal((await participationStatus(id)).aiConsented, false);
});
