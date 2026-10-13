import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = 'scenic-route';
const config = 'fly.toml';
const healthUrl = 'https://scenic-route.ca/api/health';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runCommand(command, args, timeout = 120_000) {
  console.log(`> ${command} ${args.map(quote).join(' ')}`);
  const result = await exec(command, args, { cwd: root, timeout, maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.trim();
}

function parseStatus(output) {
  // fly ssh may prepend its connection notice to the command's stdout.
  const start = output.indexOf('{');
  return JSON.parse(output.slice(start));
}

/** Maintenance deployment for the current single combined API/worker machine. */
export async function deploy({ run = runCommand, wait = sleep, now = Date.now, log = console.log,
  health = async () => {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Public health check failed');
  }, timeoutMs = 30 * 60_000 } = {}) {
  if (await run('git', ['status', '--porcelain'])) throw new Error('Commit or stash local changes before deployment.');
  if (await run('git', ['branch', '--show-current']) !== 'main') throw new Error('Check out main before deployment.');
  await run('git', ['fetch', 'origin', 'main']);
  const sha = await run('git', ['rev-parse', 'HEAD']);
  if (sha !== await run('git', ['rev-parse', 'origin/main'])) throw new Error('Pull remote main before deployment.');
  const initial = JSON.parse(await run('fly', ['status', '-a', app, '--json']));
  if (initial.Machines.length !== 1 || initial.Machines[0].state !== 'started' ||
      initial.Machines[0].config?.env?.FLY_PROCESS_GROUP !== 'app') {
    throw new Error('Expected one running combined app machine. Review the deployment procedure for this topology.');
  }
  const machine = initial.Machines[0];
  const previousImage = machine.config.image;
  if (!previousImage) throw new Error('Cannot identify the current image for recovery.');
  const image = `registry.fly.io/${app}:main-${sha}`;
  log(`Deploying ${sha}. Previous image: ${previousImage}`);
  const remote = async (...args) => run('fly', ['ssh', 'console', '-a', app, '--machine', machine.id,
    '-C', ['node', '--import', 'tsx', '/app/scripts/image-jobs.mts', ...args].map(quote).join(' ')]);
  const status = async () => parseStatus(await remote('status'));
  const until = async (description, check) => {
    const deadline = now() + timeoutMs;
    for (;;) {
      if (await check()) return;
      if (now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
      log(`Waiting for ${description}…`);
      await wait(5_000);
    }
  };
  await run('fly', ['deploy', '-a', app, '-c', config, '--build-only', '--push', '--remote-only',
    '--image-label', `main-${sha}`], 45 * 60_000);
  if (await run('git', ['status', '--porcelain']) || await run('git', ['rev-parse', 'HEAD']) !== sha) {
    throw new Error('Checkout changed during the build; production was not paused.');
  }
  const before = await status();
  if (typeof before.scheduler?.enabled !== 'boolean') throw new Error('Cannot determine admission state.');
  const workers = before.workers.filter(w => !w.draining && w.id.startsWith(`${machine.id}:`) &&
    now() - Date.parse(w.heartbeat_at) < 90_000);
  if (!workers.length) throw new Error('No healthy current worker found; production was not paused.');
  const drained = [];
  let pauseAttempted = false;
  let replacementStarted = false;
  try {
    pauseAttempted = true;
    await remote('pause');
    // Accepted queued work must finish before draining; draining first would strand it.
    await until('accepted image jobs to finish', async () => {
      const current = await status();
      return !current.states.some(s => ['queued', 'generating'].includes(s.state) && s.count > 0) &&
        current.attempts.active === 0;
    });
    for (const worker of workers) {
      drained.push(worker.id);
      await remote('drain', worker.id);
    }
    const drainedStatus = await status();
    if (drainedStatus.attempts.active !== 0 ||
        drainedStatus.states.some(s => ['queued', 'generating'].includes(s.state) && s.count > 0)) {
      throw new Error('Image work remains after draining.');
    }
    replacementStarted = true;
    await run('fly', ['deploy', '-a', app, '-c', config, '--image', image,
      '--ha=false', '--strategy', 'immediate', '--yes'], 15 * 60_000);
    await until('the new image and healthy worker', async () => {
      const current = JSON.parse(await run('fly', ['status', '-a', app, '--json']));
      if (current.Machines.length !== 1) throw new Error('Unexpected machine count after deployment.');
      const live = current.Machines[0];
      if (live.id !== machine.id || live.state !== 'started' || live.config?.image !== image ||
          !live.checks?.length || live.checks.some(c => c.status !== 'passing')) return false;
      const jobs = await status();
      return jobs.workers.some(w => !w.draining && !before.workers.some(old => old.id === w.id) &&
        w.id.startsWith(`${machine.id}:`) && now() - Date.parse(w.heartbeat_at) < 90_000);
    });
    await health();
    if (before.scheduler.enabled) await remote('resume');
    const after = await status();
    if (after.scheduler.enabled !== before.scheduler.enabled) throw new Error('Admission state verification failed.');
    log(`Deployed ${sha}. Health and worker checks passed. Submissions ${after.scheduler.enabled ? 'enabled' : 'remain paused'}.`);
  } catch (error) {
    if (!replacementStarted) {
      // A failed pause/drain can leave the old worker intact: restore its prior state.
      try {
        for (const id of drained) await remote('undrain', id);
        if (pauseAttempted && before.scheduler.enabled) await remote('resume');
      } catch (cleanupError) {
        log(`Could not restore the prior maintenance state: ${cleanupError.message}. Check jobs:status before resuming.`);
      }
    } else {
      // Resume can succeed remotely even if the connection or final verification fails.
      try { await remote('pause'); }
      catch { log('Could not confirm admission is paused; inspect production immediately.'); }
      log(`Deployment did not verify; submissions may be paused. Inspect Fly health and jobs:status before resuming. Previous image: ${previousImage}`);
      log(`Recovery: fly deploy -a ${app} -c ${config} --image ${previousImage} --ha=false --strategy immediate --yes`);
      log(`After verification: fly ssh console -a ${app} --machine ${machine.id} -C 'node --import tsx /app/scripts/image-jobs.mts resume'`);
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Usage: npm run deploy (deploys clean, current main to scenic-route)');
    process.exitCode = 1;
  } else {
    try { await deploy(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
