# Image worker operations

For routine production releases, use [operations.md](operations.md) and `npm run deploy`. This guide covers job diagnosis and manual maintenance.

## Local development

`npm run db:up` starts local PostgreSQL. `npm run dev` migrates once and starts API, worker, and web processes. `npm run dev:worker` adds a worker. When starting roles individually, run `npm run jobs:migrate` first, then use `npm run dev:api` and `npm run dev:worker`.

Local processes share storage directories when R2 is absent. Production API and workers require shared R2 storage. `fly.toml` runs one combined process; `fly.workers.toml` describes a separate API/worker topology but does not establish machine counts or capacity.

## Idle production worker

The single combined API/worker process sleeps when there are no queued or generating jobs. Submissions and retries wake it after their database transaction commits. It checks durable work on startup and every 30 minutes while idle; recovery of a missed wakeup or another process's abandoned work can therefore take up to 30 minutes. Database failures also back off to the safety interval, and a new submission can trigger an earlier attempt. Cleanup runs during these checks (at most once per minute during active work).

An idle worker does not refresh its database heartbeat. `jobs:status` includes `runtime` from the local API health endpoint: the live worker ID, active/sleeping/error state, and last successful queue check. A sleeping worker is healthy when its ID matches a non-draining registered worker and its last successful check is within 31 minutes. Active workers require a check within 90 seconds. The deployment script validates this state and requires a new worker ID after replacement; legacy releases fall back to fresh database heartbeats. Regular HTTP health checks read this state from memory without querying Postgres after initialization.

Standalone worker processes, including local `npm run dev`, continue polling every second. They cannot receive an in-process API wakeup. Do not switch production to separate workers expecting the same idle savings; add a cross-process wakeup transport first. Operator changes from a separate CLI process do not wake a sleeping combined worker; it observes them on the next scheduled check or submission. Pausing admission does not stop accepted work.

Gallery job polling stops with no pending jobs and pauses in hidden tabs. It refreshes on mount, focus/visibility restoration, submissions, and retries. Jobs submitted elsewhere appear on the next refresh.

## Diagnose stalled jobs

Run operator commands in the intended environment. For production, use Fly SSH as shown in [operations.md](operations.md); local commands load `.env.local` and otherwise use local PostgreSQL.

```sh
npm run jobs:status
```

Check admission, queued/generating jobs, live worker state (or recent heartbeats for standalone workers), active attempts, and cleanup failures. Paused admission stops new image submissions but accepted jobs continue. PostgreSQL owns shared capacity and fair claims; worker process counts do not multiply the scheduler limit. Use `npm run jobs:control -- capacity <limit>` for a deliberate capacity change and `npm run image:limits` for account overrides. Measure memory and provider load before raising concurrency.

Accepted jobs survive API restarts. Expired attempts that never dispatched requeue automatically. If a provider request may have run, recovery publishes complete saved output when possible; otherwise the job fails and requires manual retry. Retry remains blocked until the recorded provider deadline plus its safety window because the provider may still be running. Do not blindly regenerate uncertain requests.

Only successfully saved/published posters consume monthly allowance. Provider failures, timeouts, and incomplete publication release the attempt's reservation when failure is recorded. Active requests reserve capacity to prevent concurrent overuse; orphaned reservations have a bounded expiry. Deleting a published poster does not refund usage. The `jobs:reconcile` command changes accounting manually; use it only to repair a verified discrepancy, not to charge for unpublished provider output.

## Manual maintenance and separate workers

For a topology the deployment script does not support:

1. Record the current images, machine IDs, admission setting, and healthy worker IDs from `jobs:status`.
2. Pause admission with `npm run jobs:control -- pause`.
3. Let accepted queued and generating jobs finish while workers remain eligible. Wait for active capacity to clear; investigate stuck work rather than forcing replacement.
4. Drain each recorded live worker with `npm run jobs:drain -- <worker-id> --wait`. Draining before queued jobs finish would strand them.
5. Replace the intended machines with a schema/payload-compatible build. Confirm API/worker process counts and the API tile-cache mount. Use direct Node runtime commands so workers receive shutdown signals.
6. Verify health, live worker readiness (or fresh standalone worker heartbeats), and queue progress. Restore admission only if it was previously enabled. On failure, use [operations.md](operations.md).

Shutdown grace is a fallback; paid requests can outlast it. Drain before routine replacements. Review schema and job payload compatibility before overlapping versions or rolling back.

## Publication and storage cleanup

Output stays private under `posters/<userId>/_attempts/<attempt-id>/` until an atomic publication record exposes the complete set. Recovery verifies checksums and publishes without regeneration when all required bytes survived.

Do not install blanket expiry on `_attempts/`: published posters retain those paths. Cleanup removes abandoned staging objects while publication records protect committed images. Deleted-account cleanup records sweep late uploads; inspect cleanup failures in `jobs:status` instead of removing those records to silence an error. Back up publication records and their objects together; see [recovery.md](recovery.md).
