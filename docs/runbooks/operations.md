# Deployment and production recovery

Operator: Brian Ofrim. Customer contact: info@scenic-route.ca.

## Routine deployment

From a clean, up-to-date `main` checkout with dependencies installed and Fly authentication configured:

```sh
npm run deploy
```

[scripts/deploy.mjs](../../scripts/deploy.mjs) owns the routine deployment sequence. It supports the single combined API/worker machine configured by `fly.toml`: build first, pause new image submissions, finish accepted jobs, drain the current worker, replace the machine, verify the image/health/new worker, and restore the prior admission setting. Replacement briefly interrupts HTTP service. An existing admission pause stays paused.

Run the checks appropriate to the release before deploying. `npm run test:deploy` tests orchestration with mocked Fly commands; it does not test production. The script does not create backups or run paid image generation. Review migrations separately; destructive data changes need a verified recovery point from [recovery.md](recovery.md).

For multiple API/worker machines, use the maintenance procedure in [image-workers.md](image-workers.md); the script rejects that topology.

## Deployment failure

The script prints the previous image and recovery commands. Preserve that output, the candidate SHA, and the failed stage.

- Before replacement, it attempts to restore the original workers and admission setting. If cleanup fails, inspect their actual state.
- After replacement begins, it attempts to keep submissions paused. Check the machine, application logs, and worker state before resuming.
- If the process was interrupted or lost its connection, inspect production; do not assume the last command failed remotely.

```sh
fly status -a scenic-route
fly checks list -a scenic-route
fly logs -a scenic-route
fly ssh console -a scenic-route -C 'node --import tsx /app/scripts/image-jobs.mts status'
```

`jobs:status` reports admission, queue states, worker heartbeats, active attempts, and cleanup failures. If accepted jobs are stuck, follow [image-workers.md](image-workers.md) before replacing a worker.

## Rollback and reopening

Use the exact previous image printed by the script, only after checking that it supports the current database schema and queued payloads. The release command also runs during rollback; inspect migration behavior before using an older image. Do not clear migration/bootstrap markers to force a rerun.

```sh
fly deploy -a scenic-route -c fly.toml --image "$LAST_GOOD_IMAGE" --ha=false --strategy immediate --yes
```

An image rollback restores code, not deleted database rows or R2 objects. For data loss or incompatible migrations, restore a matching database/object backup into isolation using [recovery.md](recovery.md). Preserve the failed state and reconcile writes and account deletions since the recovery point.

Before reopening, verify the deployed image, passing Fly checks, a fresh non-draining worker, and the public health endpoint. Inspect Gallery and downloads when relevant to the change. HTTP health alone does not prove database availability, R2 access, email delivery, or provider availability. Paid generation and email smoke tests are separate operations.

```sh
curl --fail --silent --show-error --max-time 10 https://scenic-route.ca/api/health
fly ssh console -a scenic-route -C 'node --import tsx /app/scripts/image-jobs.mts resume'
```

Resume only when admission was previously enabled and recovery checks pass. An old worker undrained during recovery must also be verified healthy. Do not automatically replay uncertain paid requests.

## Streets map failures

The OSM cache lives on the `osm_tile_cache` volume mounted at `/tile-cache`. Preserve that mount across releases and rollbacks. Missing/unwritable cache storage blocks uncached tile requests; inspect the mount, disk usage, and aggregate `osm_tile_cache` logs. Provider throttling can also cause temporary failures. Do not bulk-fetch tiles to warm or test the cache.

The tile cache is rebuildable and is not a backup of posters. For broader outages, inspect Fly machine/log health, Neon availability, R2 errors, and worker state. For suspected unauthorized access, follow [privacy-incident.md](privacy-incident.md). Keep customer GPS, credentials, signed URLs, and private traces out of shared logs and PRs.
