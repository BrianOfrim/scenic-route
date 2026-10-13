# Image worker operations

For routine production releases, use [operations.md](operations.md) and `npm run deploy`. This guide covers job diagnosis and manual maintenance.

## Local development

`npm run db:up` starts local PostgreSQL. `npm run dev` migrates once and starts API, worker, and web processes. `npm run dev:worker` adds a worker. When starting roles individually, run `npm run jobs:migrate` first, then use `npm run dev:api` and `npm run dev:worker`.

Local processes share storage directories when R2 is absent. Production API and workers require shared R2 storage. `fly.toml` runs one combined process; `fly.workers.toml` describes a separate API/worker topology but does not establish machine counts or capacity.

## Diagnose stalled jobs

Run operator commands in the intended environment. For production, use Fly SSH as shown in [operations.md](operations.md); local commands load `.env.local` and otherwise use local PostgreSQL.

```sh
npm run jobs:status
```

Check admission, queued/generating jobs, recent worker heartbeats, active attempts, and cleanup failures. Paused admission stops new image submissions but accepted jobs continue. PostgreSQL owns shared capacity and fair claims; worker process counts do not multiply the scheduler limit. Use `npm run jobs:control -- capacity <limit>` for a deliberate capacity change and `npm run image:limits` for account overrides. Measure memory and provider load before raising concurrency.

Accepted jobs survive API restarts. Expired attempts that never dispatched requeue automatically. If a provider request may have run, recovery publishes complete saved output when possible; otherwise the job fails and requires manual retry. Retry remains blocked until the recorded provider deadline plus its safety window because the provider may still be running. Do not blindly regenerate uncertain requests.

Only successfully saved/published posters consume monthly allowance. Provider failures, timeouts, and incomplete publication release the attempt's reservation when failure is recorded. Active requests reserve capacity to prevent concurrent overuse; orphaned reservations have a bounded expiry. Deleting a published poster does not refund usage. The `jobs:reconcile` command changes accounting manually; use it only to repair a verified discrepancy, not to charge for unpublished provider output.

## Manual maintenance and separate workers

For a topology the deployment script does not support:

1. Record the current images, machine IDs, admission setting, and healthy worker IDs from `jobs:status`.
2. Pause admission with `npm run jobs:control -- pause`.
3. Let accepted queued and generating jobs finish while workers remain eligible. Wait for active capacity to clear; investigate stuck work rather than forcing replacement.
4. Drain each recorded live worker with `npm run jobs:drain -- <worker-id> --wait`. Draining before queued jobs finish would strand them.
5. Replace the intended machines with a schema/payload-compatible build. Confirm API/worker process counts and the API tile-cache mount. Use direct Node runtime commands so workers receive shutdown signals.
6. Verify health, fresh worker heartbeats, and queue progress. Restore admission only if it was previously enabled. On failure, use [operations.md](operations.md).

Shutdown grace is a fallback; paid requests can outlast it. Drain before routine replacements. Review schema and job payload compatibility before overlapping versions or rolling back.

## Publication and storage cleanup

Output stays private under `posters/<userId>/_attempts/<attempt-id>/` until an atomic publication record exposes the complete set. Recovery verifies checksums and publishes without regeneration when all required bytes survived.

Do not install blanket expiry on `_attempts/`: published posters retain those paths. Cleanup removes abandoned staging objects while publication records protect committed images. Deleted-account cleanup records sweep late uploads; inspect cleanup failures in `jobs:status` instead of removing those records to silence an error. Back up publication records and their objects together; see [recovery.md](recovery.md).
