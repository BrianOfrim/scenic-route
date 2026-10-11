import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { assertParticipation, authRecoveryPath, createParticipationGate, generationPath, recoveryPath, validateAcceptance, type Participation } from "./participation";
const current: Participation = { ready: true, blocked: false, eligible: true, termsAccepted: true, aiConsented: true,
  termsVersion: 'reviewed-terms-v1', aiVersion: 'disclosure-v1', termsUrl: '/terms', privacyUrl: '/privacy' };
const body = { eligible: true, terms: true, ai: true, termsVersion: current.termsVersion, aiVersion: current.aiVersion };
test('explicit booleans and current versions required; no client-supplied age or truthy bypass', () => {
  assert.equal(validateAcceptance(body, current), true);
  for (const invalid of [null, {}, { ...body, eligible: 'true' }, { ...body, ai: 1 }, { ...body, termsVersion: 'old' }, { ...body, aiVersion: 'old' }, { birthDate: '1990-01-01' }])
    assert.equal(validateAcceptance(invalid, current), false);
  assert.equal(validateAcceptance(body, { ...current, blocked: true }), false);
  assert.equal(validateAcceptance(body, { ...current, ready: false }), false);
});
test('refusal and stale versions block; AI refusal permits non-AI use', () => {
  for (const field of ['ready', 'eligible', 'termsAccepted'] as const) assert.throws(() => assertParticipation({ ...current, [field]: false }));
  assert.throws(() => assertParticipation({ ...current, blocked: true }));
  assert.doesNotThrow(() => assertParticipation({ ...current, aiConsented: false }));
  assert.throws(() => assertParticipation({ ...current, aiConsented: false }, true));
});
test('all HTTP generation paths require AI, recovery exceptions are exact', async () => {
  const app = new Hono<{ Variables: { user: { id: string } } }>();
  app.use('*', async (c, next) => { c.set('user', { id: 'existing-user' }); await next(); });
  app.use('*', createParticipationGate(async () => ({ ...current, aiConsented: false })));
  app.all('*', c => c.json({ ok: true }));
  for (const path of ['/api/poster/modify', '/api/poster/variant', '/api/poster/jobs', '/api/poster/jobs/abc/retry']) {
    assert.equal(generationPath(path, 'POST'), true);
    assert.equal((await app.request(path, { method: 'POST' })).status, 403);
  }
  assert.equal((await app.request('/api/activities')).status, 200);
  for (const [path, method] of [['/api/participation', 'GET'], ['/api/participation', 'POST'], ['/api/account', 'DELETE']]) assert.equal(recoveryPath(path, method), true);
  assert.equal(recoveryPath('/api/account', 'POST'), false);
  assert.equal(recoveryPath('/api/participation/bypass', 'POST'), false);
  const blocked = new Hono<{ Variables: { user: { id: string } } }>();
  blocked.use('*', async (c, next) => { c.set('user', { id: 'underage' }); await next(); });
  blocked.use('*', createParticipationGate(async () => ({ ...current, blocked: true })));
  blocked.all('*', c => c.json({ ok: true }));
  assert.equal((await blocked.request('/api/import', { method: 'POST' })).status, 403);
  assert.equal((await blocked.request('/api/account', { method: 'DELETE' })).status, 200);
  assert.equal((await blocked.request('/api/participation')).status, 200);
});

test('authentication recovery remains available while profile mutation is gated', () => {
  for (const path of ['/api/auth/sign-out', '/api/auth/get-session', '/api/auth/callback/google', '/api/auth/sign-in/email', '/api/auth/sign-in/social', '/api/auth/reset-password']) assert.equal(authRecoveryPath(path), true);
  for (const path of ['/api/auth/update-user', '/api/auth/link-social', '/api/auth/delete-user', '/api/auth/get-session/bypass']) assert.equal(authRecoveryPath(path), false);
});
