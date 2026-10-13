import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploy } from './deploy.mjs';

function fixture({ failAt, enabled = true, dirty = false, queued = false, queuedForever = false, noNewWorker = false } = {}) {
  const calls = [];
  let time = Date.parse('2026-10-13T18:00:00Z');
  let published = false;
  let paused = !enabled;
  let draining = false;
  let queuedChecks = queuedForever ? Infinity : queued ? 1 : 0;
  const worker = { id: 'machine:1:old', draining: false, heartbeat_at: new Date(time).toISOString() };
  const machine = { id: 'machine', state: 'started', config: { env: { FLY_PROCESS_GROUP: 'app' }, image: 'registry.fly.io/scenic-route:previous' }, checks: [{ status: 'passing' }] };
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === 'git') {
      if (args[0] === 'status') return dirty ? ' M file' : '';
      if (args[0] === 'branch') return 'main';
      if (args[0] === 'rev-parse') return 'abc123';
      return '';
    }
    const remote = args[0] === 'ssh' ? args.at(-1) : '';
    const is = cmd => remote.endsWith(`'${cmd}'`);
    if (args.includes('--build-only')) {
      if (failAt === 'build') throw new Error('build failed');
      return '';
    }
    if (args[0] === 'deploy') {
      if (failAt === 'deploy') throw new Error('deployment failed');
      published = true;
      machine.config.image = 'registry.fly.io/scenic-route:main-abc123';
      return '';
    }
    if (args[0] === 'status') return JSON.stringify({ Machines: [machine] });
    if (is('pause')) { paused = true; return ''; }
    if (is('resume')) { paused = false; return ''; }
    if (remote.includes("'undrain'")) { draining = false; return ''; }
    if (remote.includes("'drain'")) {
      draining = true;
      if (failAt === 'drain') throw new Error('drain failed');
      return '';
    }
    if (is('status')) {
      const pending = paused && queuedChecks-- > 0;
      const workers = published && !noNewWorker
        ? [{ ...worker, id: 'machine:2:new', heartbeat_at: new Date(time).toISOString() }]
        : [{ ...worker, draining }];
      return 'Connecting…\n' + JSON.stringify({ scheduler: { enabled: !paused }, workers,
        states: pending ? [{ state: 'queued', count: 1 }] : [], attempts: { active: pending ? 1 : 0 } });
    }
    throw new Error(`Unexpected command: ${command} ${args}`);
  };
  const options = { run, now: () => time, wait: async ms => { time += ms; }, timeoutMs: 5_000,
    log: () => {}, health: async () => { if (failAt === 'health') throw new Error('health failed'); } };
  return { calls, options, paused: () => paused, draining: () => draining };
}
const remoteCalls = f => f.calls.filter(c => c.args[0] === 'ssh').map(c => c.args.at(-1));

test('builds before pausing, finishes queued work, drains, verifies fresh worker, and resumes', async () => {
  const f = fixture({ queued: true });
  await deploy(f.options);
  const commands = f.calls.map(c => c.args.join(' '));
  assert.ok(commands.findIndex(c => c.includes('--build-only')) < commands.findIndex(c => c.includes("'pause'")));
  const remotes = remoteCalls(f);
  const pause = remotes.findIndex(c => c.endsWith("'pause'"));
  const drain = remotes.findIndex(c => c.includes("'drain'"));
  assert.ok(remotes.slice(pause + 1, drain).filter(c => c.endsWith("'status'")).length >= 2);
  assert.equal(f.paused(), false);
  assert.ok(f.calls.some(c => c.args.includes('--ha=false') && c.args.includes('immediate')));
});

test('dirty checkout is rejected before contacting production', async () => {
  const f = fixture({ dirty: true });
  await assert.rejects(deploy(f.options), /Commit or stash/);
  assert.equal(f.calls.length, 1);
});

test('build failure leaves submissions and workers untouched', async () => {
  const f = fixture({ failAt: 'build' });
  await assert.rejects(deploy(f.options), /build failed/);
  assert.equal(f.paused(), false);
  assert.equal(remoteCalls(f).length, 0);
});

test('failed drain restores old worker and admission', async () => {
  const f = fixture({ failAt: 'drain' });
  await assert.rejects(deploy(f.options), /drain failed/);
  assert.equal(f.draining(), false);
  assert.equal(f.paused(), false);
  assert.ok(!f.calls.some(c => c.args[0] === 'deploy' && c.args.includes('--image')));
});

test('unfinished jobs time out without draining or deploying and restore admission', async () => {
  const f = fixture({ queuedForever: true });
  await assert.rejects(deploy(f.options), /Timed out waiting for accepted image jobs/);
  assert.equal(f.paused(), false);
  assert.equal(f.draining(), false);
  assert.ok(!f.calls.some(c => c.args[0] === 'deploy' && c.args.includes('--image')));
});

for (const failAt of ['deploy', 'health']) {
  test(`${failAt} failure leaves submissions paused`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(deploy(f.options), /failed/);
    assert.equal(f.paused(), true);
    assert.ok(!remoteCalls(f).some(c => c.endsWith("'resume'")));
  });
}

test('old worker heartbeat cannot satisfy post-deploy readiness', async () => {
  const f = fixture({ noNewWorker: true });
  await assert.rejects(deploy(f.options), /Timed out waiting/);
  assert.equal(f.paused(), true);
});

test('previously paused admission stays paused after a successful deploy', async () => {
  const f = fixture({ enabled: false });
  await deploy(f.options);
  assert.equal(f.paused(), true);
  assert.ok(!remoteCalls(f).some(c => c.endsWith("'resume'")));
});
