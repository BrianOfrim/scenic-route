# Scenic Route release and monitoring runbook

Owner/incident lead: **Brian Ofrim, Alberta, Canada**. Customer/privacy contact: **info@scenic-route.ca**. This is an operator procedure, not evidence of a production deployment, restore or configured external monitoring. Record sanitized execution outcomes in `docs/prelaunch-evidence/operator-runbooks.md`; keep credentials and customer data out of Git.

## Verified code baseline and gates

Baseline: `55e18db476d4e1b8c0450f87fc24ddddd68f9e33` (main at merge). The first draft of these runbooks described `6283736df5be9a4d92a08bef0e84a427e915f89f`; queue and admission facts below follow the merged tree. `Dockerfile` builds the web app and runs Node/tsx API on port 8790. `fly.toml` names `scenic-route`, region `dfw`, HTTPS, auto-stop disabled and minimum one machine. **Minimum one does not enforce maximum one.** README identifies Neon Postgres and R2 images; actual production secrets, machine count, restore window and backups remain operator checks.

Run exactly one serving API process/machine. Job state, deduplication and concurrency are process-local (`generationJobs.ts`, `requestQueue.ts`). The image scheduler defaults to 128 active requests per process (`OPENROUTER_IMAGE_CONCURRENCY`) and eight active requests per user (`OPENROUTER_IMAGE_USER_CONCURRENCY`). Each user may hold 16 unfinished jobs, counting running, waiting and retry backoff. There is no global waiting-job cap. Accepted generation, refinement, and variant jobs have no admission timeout. Waiting users take turns, with FIFO order within a user. Batches accept 1–200 jobs and, by default, at most eight theme/palette selections. The account-lock pool allows 144 connections and times out after ten seconds; the general query pool defaults to ten more connections. A separate chat queue still defaults to four (`OPENROUTER_PLAN_CONCURRENCY`). `npm run image:limits` and `npm run poster:limit` change one account without a restart and do not raise the process-wide 128, 144 or 200 ceilings. Verify the deployed commit before treating these defaults as live.

Refinements and variants submit a client-generated `submissionId` to `POST /api/poster/modify` and `POST /api/poster/variant`. Both return HTTP 202 with job metadata, then use the shared worker, polling, unfinished limits and manual retry/dismissal routes. Submission does not wait for an active image slot. The worker rechecks account access and consent and resolves the owned source at execution; deleting the source before execution can fail the job. Annotations and edit text are retained with the job.


## Release

1. Record candidate SHA, last good SHA, exact last good Fly image reference/digest, config and secret names (never values). Review migration, auth, storage and pending queue changes. Run `npm ci`, `npm test`, `npm run build` with an isolated database. Rehearse startup and rollback on restored copies using [recovery.md](recovery.md).
2. Schedule a maintenance window. The repo has no admission pause, global drain or aggregate queue-count endpoint. One user's `/api/poster/jobs` is not a global drain. Deleting an account acquires an exclusive lock, then cancels that account's waiting image jobs. It returns 409 while another request still holds the account lock. That is not a maintenance drain. Public beta admission caps counted accounts at 100 and waitlists the rest (`beta_status`). It does not stop writes from admitted users. Admit with `npm run beta:admit` against the intended database; that command is not an HTTP endpoint and sends no email. Ask users to finish work; if drain cannot be established, Brian explicitly accepts interruption or postpones. A separately verified maintenance mechanism must block public writes while background jobs finish; none is supplied here.
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

`index.ts` initializes DB, seals imported-ID floors and calls `purgeLegacyApiData()` before listening. `db.ts` serializes DDL with a Postgres advisory lock, but the full migration spans separate queries without a single encompassing transaction or versioned down migrations. `migrateBetaAdmission` commits its own transaction (`beta_status`, `beta_exempt`, `beta_capacity` and its trigger) before later queries add `image_limits` and `poster_monthly_limit`. Failed startup can leave earlier changes committed. The trigger turns new admissions into `waiting` once 100 counted accounts are admitted; existing rows default to `admitted` when the column is added. Conditional SQLite import runs only when activities/settings are empty; failures are warned and skipped. Keep old SQLite files out of recovery checkouts unless deliberately reviewed.

`fileFirstMigration.ts` deletes derived legacy posters **before** its DB transaction deletes non-imported Strava activities/credentials and sets `file_first_purge_v1`. Object deletes cannot be rolled back by Postgres. Root-level old trace cleanup occurs after the marker commits; cleanup failure can leave traces without rerunning it. `bootstrap.ts` also moves unscoped objects and assigns DB ownership. Never erase markers to force a production rerun.

1. Stop traffic/API. Preserve failed SHA/image, startup error, marker values, current DB/object state and private evidence. Storage failure can mean partial deletion.
2. If data/schema remain compatible, test the previous image against a copy first, then during approved recovery use `fly deploy -a scenic-route --image "$LAST_GOOD_IMAGE" --ha=false --strategy immediate` with the exact recorded image. This reverts code only; review config/secrets separately.
3. If compatibility is uncertain or data/objects were deleted, restore a matching pair into isolation first. Do not improvise down-DDL. Compare writes and account-deletion requests since backup; avoid resurrecting deleted accounts. Brian chooses recovery point and reconciliation plan.
4. Production cutover requires a separately approved change after rehearsal. Preserve original DB/bucket until acceptance; perform all smoke checks before reopening. Never claim an old app image restores deleted data.

## Restart behavior and customer handling

On API restart queued/generating jobs, in-memory automatic retries, failed-job retry state and submission deduplication disappear. Explicit upstream HTTP 502/503/504 retries run at most twice in that process, after 5 and 15 seconds plus jitter, and are not resumed after restart. Completed posters persist in configured storage; no durable job ledger recovers unsaved queued prompts. Browser polling every three seconds refreshes gallery posters when a pending job disappears and then removes its card (`apps/web/src/api.ts`). Empty job state cannot distinguish restart, completion, dismissal or expiry. The API exposes no boot ID or interrupted status.

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

Production-only, with Brian's separately authorized test account and cost budget: sign in, inspect scoped activities/gallery/quota, import synthetic GPX, upload references, submit one image, observe state progression, reload browser and download original/thumbnail. The account must be beta-admitted; a waitlisted account receives 403 `BETA_WAITLISTED` on imports and poster generation and can still delete itself. Test refinement only if authorized. Cross-account tests use dedicated fixtures. Verification/reset delivery and account deletion change accounts/send mail: rehearse locally with mail suppressed; do not run them as part of this documentation task. Record results and clean up only approved fixtures.

## Actionable monitoring setup

Existing Fly HTTP check: GET `/api/health`, 30-second interval, 5-second timeout, 15-second grace. It checks routing/health; external alert delivery is not configured by this repo. No monitoring service was provisioned here.

1. With Brian's chosen monitor service/credentials, create an HTTPS GET monitor requiring 200 and JSON `ok: true`, with no cookies/secrets. Proposed starting policy: two failures at a 60-second interval, recovery after two successes. Brian approves policy and destination info@scenic-route.ca before activation. Test delivery using staging or the service's test function; document an alternate contact route if the mailbox fails.
2. Add home/asset and certificate-expiry checks. A staging synthetic flow should separately test DB reads, object access and worker progress because health is shallow/cached. Record recipient and escalation ownership.
3. Triage via `fly logs -a scenic-route`, Fly machine/check metrics, Neon connection/error metrics and R2 request/error analytics. Configure chosen error/log-service rules for restart/OOM, 5xx bursts, pool/storage/account-deletion errors, image deadlines and explicit provider 429/502/503/504. Repo gaps: no error tracker, aggregate job-depth metric or worker-heartbeat endpoint. Healthy HTTP does not prove generations progress.
4. Inspect private `data/llm-traces/` attempt phase/status/rate-limit/timing evidence. A running trace only means completion was not recorded. Redact GPS, prompts, tokens and signed URLs before sharing; never post full traces in public issues/alerts. Local traces may disappear on redeploy.
5. Record UTC time, URL/status, image/SHA and trace ID, determine scope, check provider limits/health, and follow recovery or [privacy response](privacy-incident.md). Test failure/recovery routing before calling monitoring operational.

No log or backup retention schedule is approved here; Brian must choose access, destination, deletion policy and automation separately.


## OSM Standard tile cache rollout and recovery

The tile proxy remains part of the sole API process. Fly root storage is ephemeral; the new dedicated `osm_tile_cache` volume mounts at `/tile-cache`. The source configuration does not prove that this volume has been provisioned or attached. This code change has not deployed or changed cloud resources.

After Brian separately authorizes production deployment:

1. Confirm one serving machine in `dfw`, record the current image, and drain generation work using the existing maintenance procedure. Do not add a replica or overlap API processes.
2. Provision a 3 GB encrypted volume in `dfw` named `osm_tile_cache` and attach it through the updated `fly.toml`. Review actual volume placement and machine attachment before replacement. Example provisioning command: `fly volumes create osm_tile_cache --region dfw --size 3 --app scenic-route`. Volumes attach to one machine and are not automatically replicated: see [Fly volume documentation](https://docs.fly.io/volumes/overview/).
3. Deploy with the existing immediate, single-machine procedure. Confirm the mount; production requests verify a non-root filesystem mount before fetching. Missing/unwritable storage disables OSM misses, while the other API features remain available. Keep the volume on subsequent deploys and rollbacks. Do not roll back to the old uncached OSM proxy; disable OSM in a cache-capable release if necessary.
4. Sign in with the separately approved test account, open one small Streets viewport, verify readable credits/link and the issue link, then revisit it. Inspect aggregate `osm_tile_cache` logs for hits, bounded upstream work, errors and cache usage. Restart only after draining other jobs, and confirm the same tiles are served from disk. Never pan/zoom through regions as a load test or seed the cache.
5. Check mobile attribution with the poster sheet open and drag the map. The browser sends origin-only Referer; the upstream request identifies Scenic Route. Verify no cookies, private page paths, query parameters, account IDs, or client IPs reach OSM.

Configuration:

- `OSM_TILES_ENABLED=true` is the default; `false` stops OSM tile access. Restart the API after changing configuration. Saved entries remain on disk; Satellite/Schematic remain available. This is not an uncached-access switch.
- `OSM_TILE_CACHE_DIR` defaults locally to `data/tile-cache` (ignored by Git), and in production to `/tile-cache`. Local development needs no Fly account or volume.
- `OSM_TILE_CACHE_MAX_BYTES=2147483648` and `OSM_TILE_CACHE_MAX_ENTRIES=50000` bound serialized entries/index. The 3 GB volume leaves headroom for atomic writes and filesystem overhead. Seven-day fallback entries are protected until expiry; other eligible entries use expired-first LRU eviction. Full protected storage returns 503; investigate before increasing the limits.
- `OSM_TILE_ALLOWED_ORIGINS` is a comma-separated list of exact origins. Development defaults to `WEB_ORIGIN`; production defaults to `https://scenic-route.ca,https://scenic-route.fly.dev`. Missing/foreign Referer is rejected, not fabricated. Never include private URL paths.

Failures: fresh readable cache entries remain usable during storage/upstream failures; expired entries require successful validation. Upstream 429/503 triggers service cooldown respecting Retry-After (bounded to 24 hours); other failed tile requests use a 30-second cooldown. Fix the mount/permissions/disk space and restart to recover write health. Corrupt entries and interrupted temporary writes are removed on recovery. There is no cache warming, alternate-host retry or provider substitution.

Logs contain only aggregate hit/miss/coalescing/revalidation/error/eviction/saturation counters, bytes, entry count and queue state. Routine events are sampled; failure events are always logged. Diagnose sustained fresh eviction/cache saturation by increasing the volume and cache budget or changing to a suitable provider. Capacity is an initial beta default, not a measured workload guarantee. Do not log tile keys/coordinates, Referers, credentials, or user identities.

The new volume is a rebuildable tile cache, not a backup of posters or customer data. Fly snapshots may contain tile-access geography; keep access restricted and use the volume's default five-day snapshot retention initially. Volume storage is US$0.15/GB-month (3 GB: about US$0.45); snapshots have separate allowances/pricing. See [Fly pricing](https://docs.fly.io/about/pricing/). A host/volume failure may interrupt Streets maps; Fly does not give this single-machine architecture redundancy. Restore a snapshot or replace the volume without any bulk refill job.
