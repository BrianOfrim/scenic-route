# Scenic Route release and monitoring runbook

Owner/incident lead: **Brian Ofrim, Alberta, Canada**. Customer/privacy contact: **info@scenic-route.ca**. This is an operator procedure, not evidence of a production deployment, restore or configured external monitoring. Record sanitized execution outcomes in `docs/prelaunch-evidence/operator-runbooks.md`; keep credentials and customer data out of Git.

## Verified code baseline and gates

Baseline: `6283736df5be9a4d92a08bef0e84a427e915f89f`. `Dockerfile` builds the web app and runs Node/tsx API on port 8790. `fly.toml` names `scenic-route`, region `dfw`, HTTPS, auto-stop disabled and minimum one machine. **Minimum one does not enforce maximum one.** README identifies Neon Postgres and R2 images; actual production secrets, machine count, restore window and backups remain operator checks.

Run exactly one serving API process/machine. Job state, deduplication and concurrency are process-local (`generationJobs.ts`, `requestQueue.ts`). The approved future target of 100 globally/four per user/eight waiting is in a pending PR, **not this baseline**. Here worker concurrency defaults to four, batches accept 1–200 jobs, and the separate provider FIFO defaults to 100 waiting calls. Verify the deployed queue commit before advertising the future limits.

## Release

1. Record candidate SHA, last good SHA, exact last good Fly image reference/digest, config and secret names (never values). Review migration, auth, storage and pending queue changes. Run `npm ci`, `npm test`, `npm run build` with an isolated database. Rehearse startup and rollback on restored copies using [recovery.md](recovery.md).
2. Schedule a maintenance window. The repo has no admission pause, global drain, cancellation or aggregate queue-count endpoint. One user's `/api/poster/jobs` is not a global drain. Ask users to finish work; if drain cannot be established, Brian explicitly accepts interruption or postpones. A separately verified maintenance mechanism must block public writes while background jobs finish; none is supplied here.
3. Stop the sole API after draining, capture matching DB/object backups, and record UTC quiescence time. Require a verified restorable pair before destructive migrations. Preserve local diagnostics before replacing the machine: no Fly volume is configured for `data/`.
4. During the approved window only, deploy the reviewed SHA from its clean checkout:

```bash
fly machine list -a scenic-route
fly deploy -a scenic-route --ha=false --strategy immediate
fly machine list -a scenic-route
fly checks list -a scenic-route
```

Immediate replacement causes downtime and discards in-memory jobs. `--ha=false` avoids creating a spare for a new single-machine service; it does not remove existing replicas. Resolve extra machines in a separately reviewed operational change first. Do not overlap serving processes via rolling/bluegreen deployment with this architecture. Confirm flags with installed `fly deploy --help`; see [official deploy reference](https://docs.fly.io/flyctl/cmd/fly_deploy).
5. Perform smoke checks below, record image/SHA, status and timestamps, and reopen traffic after acceptance. Otherwise rollback.

## Migration failure and rollback

`index.ts` initializes DB, seals imported-ID floors and calls `purgeLegacyApiData()` before listening. `db.ts` serializes DDL with a Postgres advisory lock, but the full migration spans separate queries without a single encompassing transaction or versioned down migrations. Failed startup can leave earlier changes committed. Conditional SQLite import runs only when activities/settings are empty; failures are warned and skipped. Keep old SQLite files out of recovery checkouts unless deliberately reviewed.

`fileFirstMigration.ts` deletes derived legacy posters **before** its DB transaction deletes non-imported Strava activities/credentials and sets `file_first_purge_v1`. Object deletes cannot be rolled back by Postgres. Root-level old trace cleanup occurs after the marker commits; cleanup failure can leave traces without rerunning it. `bootstrap.ts` also moves unscoped objects and assigns DB ownership. Never erase markers to force a production rerun.

1. Stop traffic/API. Preserve failed SHA/image, startup error, marker values, current DB/object state and private evidence. Storage failure can mean partial deletion.
2. If data/schema remain compatible, test the previous image against a copy first, then during approved recovery use `fly deploy -a scenic-route --image "$LAST_GOOD_IMAGE" --ha=false --strategy immediate` with the exact recorded image. This reverts code only; review config/secrets separately.
3. If compatibility is uncertain or data/objects were deleted, restore a matching pair into isolation first. Do not improvise down-DDL. Compare writes and account-deletion requests since backup; avoid resurrecting deleted accounts. Brian chooses recovery point and reconciliation plan.
4. Production cutover requires a separately approved change after rehearsal. Preserve original DB/bucket until acceptance; perform all smoke checks before reopening. Never claim an old app image restores deleted data.

## Restart behavior and customer handling

On API restart queued/generating jobs, failed-job retry state and submission deduplication disappear. Completed posters persist in configured storage; no durable job ledger recovers unsaved queued prompts. Browser polling every three seconds refreshes gallery posters when a pending job disappears and then removes its card (`apps/web/src/api.ts`). Empty job state cannot distinguish restart, completion, dismissal or expiry. The API exposes no boot ID or interrupted status.

Check Gallery/storage first, then correlate private trace/request IDs and provider records. Provider work may complete or incur charges even if the API dies before saving. Never automatically replay submission IDs after restart; deduplication was lost. Reconcile before resetting quota/refunding: unsettled reservations expire after at least 24 hours (longer for custom deadlines), and generated outputs may count even if saving fails.

For a confirmed restart, Brian can use: “The service restarted while images were being prepared. Please check your Gallery first. Some work may have been interrupted; contact info@scenic-route.ca before retrying if an image is missing or your allowance looks wrong.” This is an operator template, **not implemented UI**. Durable recovery, interruption cards and a maintenance/drain API remain gaps. A truthful automatic restart banner needs an API signal; this docs change adds none.

## Production smoke checks

Read-only checks:

```bash
curl --fail --silent --show-error --max-time 10 https://scenic-route.ca/api/health
curl --fail --silent --show-error --max-time 10 https://scenic-route.ca/api/auth/config
curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}\n' https://scenic-route.ca/api/activities
```

Expect health 200 `{"ok":true}`, auth config 200 with boolean `google`, anonymous activities 401. Check HTTPS, home/assets and usable mobile/desktop Gallery. Health is public, but `initDb()` is cached after initialization: a green result does **not** prove a fresh DB round trip, R2 read/write, email delivery, worker progress or provider availability.

Production-only, with Brian's separately authorized test account and cost budget: sign in, inspect scoped activities/gallery/quota, import synthetic GPX, upload references, submit one image, observe state progression, reload browser and download original/thumbnail. Test refinement only if authorized. Cross-account tests use dedicated fixtures. Verification/reset delivery and account deletion change accounts/send mail: rehearse locally with mail suppressed; do not run them as part of this documentation task. Record results and clean up only approved fixtures.

## Actionable monitoring setup

Existing Fly HTTP check: GET `/api/health`, 30-second interval, 5-second timeout, 15-second grace. It checks routing/health; external alert delivery is not configured by this repo. No monitoring service was provisioned here.

1. With Brian's chosen monitor service/credentials, create an HTTPS GET monitor requiring 200 and JSON `ok: true`, with no cookies/secrets. Proposed starting policy: two failures at a 60-second interval, recovery after two successes. Brian approves policy and destination info@scenic-route.ca before activation. Test delivery using staging or the service's test function; document an alternate contact route if the mailbox fails.
2. Add home/asset and certificate-expiry checks. A staging synthetic flow should separately test DB reads, object access and worker progress because health is shallow/cached. Record recipient and escalation ownership.
3. Triage via `fly logs -a scenic-route`, Fly machine/check metrics, Neon connection/error metrics and R2 request/error analytics. Configure chosen error/log-service rules for restart/OOM, 5xx bursts, pool/storage/account-deletion errors, image deadlines and explicit provider 429/502/503/504. Repo gaps: no error tracker, aggregate job-depth metric or worker-heartbeat endpoint. Healthy HTTP does not prove generations progress.
4. Inspect private `data/llm-traces/` attempt phase/status/rate-limit/timing evidence. A running trace only means completion was not recorded. Redact GPS, prompts, tokens and signed URLs before sharing; never post full traces in public issues/alerts. Local traces may disappear on redeploy.
5. Record UTC time, URL/status, image/SHA and trace ID, determine scope, check provider limits/health, and follow recovery or [privacy response](privacy-incident.md). Test failure/recovery routing before calling monitoring operational.

No log or backup retention schedule is approved here; Brian must choose access, destination, deletion policy and automation separately.
