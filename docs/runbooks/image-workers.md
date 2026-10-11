# Durable image jobs and worker operations

## Local development

Start the existing local PostgreSQL service with `npm run db:up`, then `npm run dev`. This migrates/backfills once and starts separate API, image worker, and web processes. `npm run dev:worker` starts another independent worker against the same database. `npm run dev:api` starts only HTTP serving; run `npm run jobs:migrate` first when starting roles individually. Both processes share the repository's local storage directories when R2 is absent. Local references become data URLs at execution, never image bytes in job rows. Production requires R2.

Use `APP_ROLE=combined npm run start -w @scenic-route/api` for the initial single-process rollout. Separate processes use `node --import tsx apps/api/src/runtime.ts api` and `node --import tsx apps/api/src/runtime.ts worker`. `IMAGE_WORKER_CONCURRENCY` defaults to 128 for combined and 64 for workers; query and account pools default to ten and eight connections. Measure memory with real reference sizes before relying on those ceilings. A reference batch may be up to 40 MB; 64 simultaneous large requests can exceed a 1 GB worker.

## Scheduling and recovery

PostgreSQL owns admission, fair claims, active capacity, attempts, 90-second leases, and publication. Workers heartbeat every 15 seconds; external provider calls and image uploads hold no database connections. The scheduler's `global_limit` is the authoritative shared limit, initially 128. Set it with `npm run jobs:control -- capacity 128`; process-local environment changes cannot multiply it. Account limits remain configurable with `npm run image:limits`.

`npm run jobs:status` reports workers, queue states/age, active and uncertain attempts, and cleanup errors without prompts. `npm run jobs:control -- pause` pauses new submissions, while accepted work continues. `resume` reopens admission.

Expired attempts that never marked dispatch requeue automatically. Once dispatch might have occurred, absence of a durable complete output requires manual retry. The UI reports potential duplicate charges and temporarily reserved allowance, and disables retry until the recorded provider deadline plus 60 seconds. This tracks application attempts; the deadline does not guarantee that the upstream provider stopped.

Explicit upstream 429/502/503/504 errors retry at most three times and honor Retry-After. Successful provider output consumes allowance even when publication fails. Unknown attempts retain allowance until its original reservation expiry, at least 24 hours. To reconcile an outcome confirmed from provider evidence, use `npm run jobs:reconcile -- <attempt-id> <confirmed-output-count>`; this changes allowance accounting and never calls the provider.

Images remain private under `_attempts/<attempt-id>/` until an atomic PostgreSQL publication record makes the complete set visible. Recovery verifies file checksums and resumes publication without regeneration when all bytes survived. Lost bytes and partial outputs cannot be reconstructed automatically.

The cleanup worker applies a 24-hour application lifecycle to uncommitted attempts. **Do not install a blanket R2 lifecycle expiry on `_attempts/`: committed images retain those paths.** Publication rows protect committed files. Cleanup retains independent attempt path records even after job retention ends. Deleted-account tombstones are retained to repeatedly sweep late uploads; they contain account IDs, not prompts or email addresses. Completion means immediate loss of application access; physical removal is reconciled separately. Investigate cleanup errors with `jobs:status`.

Dedicated workers never write private trace files locally. With R2, traces use the shared user-scoped `traces/` prefix. Without R2, local workers print trace IDs/status only. Storage errors never fall back to printing prompts.

## Initial production cutover

The currently deployed memory queue has no durable global drain. New pause commands cannot control the old binary. Block submissions using a verified maintenance mechanism, establish that existing work finished, and take matching PostgreSQL/R2 backups before replacing it. If the old queue cannot be proven drained, postpone cutover rather than assume a restart is harmless.

Deploy the reviewed source with `fly.toml` first: one combined process, unchanged global capacity. Its release command runs additive schema migration, the existing imported-ID/legacy purge initialization with preserved markers, and publication backfill. New runtime roles connect without running legacy migrations/imports. Preserve existing migration/bootstrap markers and legacy posters. Rehearse on an isolated restored database and bucket before the production release.

Once single-machine recovery and load checks pass, deploy `fly.workers.toml` and explicitly set one API and two worker machines:

```sh
fly deploy -a scenic-route -c fly.workers.toml
fly scale count api=1 worker=2 -a scenic-route
```

Only the API serves HTTP and mounts the tile cache. Workers stay running without HTTP traffic. Validate Fly machine/process counts and R2 configuration; a config file does not by itself establish the desired counts. Budget aggregate query/account pools across all roles and migration clients. Runtime worker readiness is visible through recent heartbeats in `jobs:status`.

## Subsequent deployments

Run operator commands against the intended production database with runtime dependencies and secure environment configuration; never print credentials. Capture current worker IDs from `jobs:status`, then drain those exact IDs before stopping or replacing them:

```sh
npm run jobs:drain -- <old-worker-id> --wait
```

Drain each old worker; newly registered workers use new IDs and remain eligible. A worker marked draining keeps heartbeats and finishes existing work. For a maintenance release, pause admission, drain all current workers, deploy, verify new worker heartbeats, then resume. For continuous service, provision new workers before draining old ones and ensure both versions support the same payload/schema. Runtime supports payload version 1; unsupported jobs are skipped rather than executed incorrectly.

Fly's five-minute maximum shutdown grace is a fallback: provider deadlines can be ten minutes per image. Pre-drain is required for routine deploys. Crashes and forced shutdowns use durable recovery with uncertain outcomes rather than blind paid retries. Use direct Node process commands so signals reach the worker.

Rollback only to a schema/payload-compatible durable build or combined mode. The former memory build cannot operate the new publication index or queued work. API restarts do not lose jobs; with separate workers, API restarts do not stop generation.

## Verification

`npm test` runs API/database fixtures serially and the web suite. The durable suite spawns two real Node processes to prove shared claims, exercises 128 active claims, ownership loss, quota, publication recovery, and late upload cleanup. Provider responses are mocked: no paid generation is needed for these checks. `npm run build` and API TypeScript checks must pass.

Before increasing concurrency, load-test representative reference/output sizes and slow object storage; measure completion throughput, RSS, event-loop delay, pool waits, publication latency, uncertain failures, and cleanup backlog. The load fixture also sends 128 concurrent mocked two-image requests with approximately 197 KB image/reference buffers and delayed local uploads. It verifies idle database connections during provider waits and successful publication of 256 outputs. This does not establish a memory budget for the maximum 40 MB references or live R2 latency.
