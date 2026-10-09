# Operator runbooks evidence

Date: 2026-10-08 (America/Edmonton), merge reconciliation 2026-10-09. Owner: Brian Ofrim, Alberta, Canada, info@scenic-route.ca. Original draft baseline `6283736df5be9a4d92a08bef0e84a427e915f89f`. Procedures now describe merged main `55e18db476d4e1b8c0450f87fc24ddddd68f9e33`. Branch `codex/operator-runbooks`. Shared primary checkout preserved.

## Implemented

Documentation only: [release/rollback, restart, smoke and monitoring](../runbooks/operations.md), [matched database/image backup and isolated recovery](../runbooks/recovery.md), [privacy/security incident decisions](../runbooks/privacy-incident.md), README discovery links. No production changes, real email, monitoring provisioning or paid image generation. No UI restart change: jobs API lacks a boot/interruption signal, and disappeared jobs also represent completion/expiry/dismissal. Documented customer template and architectural gap rather than claiming durable recovery.

Inspected Dockerfile, fly.toml, docker-compose.yml, API startup, DB migrations/SQLite import, file-first destructive purge, bootstrap ownership migration, local/R2 storage, reference uploads, jobs/provider queues, quota and browser job polling. The 2026-10-08 draft kept a then-pending queue target separate from that older baseline. After merging main, the runbooks describe the landed scheduler instead: 128 active image requests per process, eight active and 16 unfinished per user, no global waiting cap, fair per-user turns, a 144-connection account-lock pool, per-account limit commands, and the 100-account public beta waitlist. Account deletion cancels that account's waiting jobs; there is still no global drain.

Official sources consulted: Fly deploy command reference; PostgreSQL pg_dump; Cloudflare R2 AWS CLI; Neon's maintained branch-restore documentation; Alberta OIPC breach requirements; Canadian OPC breach guidance and privacy-law overview; FTC breach-response/health-rule guidance; California Attorney General reporting guidance. Direct links appear beside the relevant procedures. Canadian and US applicability remains an incident-specific decision, not a legal clearance.

## Local checks performed

- `npm ci --ignore-scripts` succeeded using lockfile in isolated worktree. Installer reported five dependency vulnerabilities (two high, three critical); no package changes or audit remediation undertaken in this docs task.
- Focused tests: `DATABASE_URL=postgres://scenic:scenic@127.0.0.1:55437/runbooks node_modules/.bin/tsx --test apps/api/src/requestQueue.test.ts apps/api/src/generationJobs.test.ts apps/api/src/storage.test.ts apps/api/src/referenceUploads.test.ts apps/api/src/authRequired.test.ts apps/api/src/posterQuota.test.ts apps/web/src/gallery/generationState.test.ts` — **40 passed, zero failed**. Disposable Postgres 16 container, separate database/port; mocked provider/storage tests do not prove production backup availability.
- API booted on local port 18793 against that disposable DB with zero env files loaded and local storage, without provider/email credentials. Anonymous requests: `/api/health` 200 `{"ok":true}`; `/api/auth/config` 200 `{"google":false}`; `/api/activities` 401 `{"error":"sign in required"}`.
- After stopping only disposable Postgres, the same initialized API still returned health 200 `{"ok":true}`. Confirms documented limitation: cached `initDb()` health does not check fresh DB availability. No health implementation changed.
- Documentation whitespace and local Markdown-link checks passed. No application code changed; full build/test suite not rerun for this documentation-only change.

## Merge reconciliation

`origin/main` at `55e18db476d4e1b8c0450f87fc24ddddd68f9e33` conflicted only in `README.md`. Both additions are kept: per-account generation limits, then the operator-runbook links. `docs/runbooks/operations.md` and `docs/runbooks/recovery.md` were updated so release, restart and restore steps match the merged queue, beta admission and `beta_capacity` row. The privacy runbook did not depend on those code changes. The local checks in the previous section remain evidence for the 2026-10-08 baseline only. They were not re-run against the merged tree in this reconciliation. No application code changed in the conflict resolution.

## Production-only / not performed

No production health request, Fly deployment/rollback, production account action, external alert delivery test, production DB snapshot, R2 backup, Neon restore-window inventory or full backup restore was performed. **Backup availability, recoverability and RPO/RTO remain unverified.** A fresh disposable DB used for endpoint checks is not a restored backup.

Brian must verify sole API machine, deployed queue version, matching independent snapshots, isolated DB/object restore and deletion reconciliation, maintenance/drain mechanism, previous-image compatibility, smoke flows and monitoring alert routing before marking those operational controls complete. No new log/backup retention schedules approved. Incident records have the separately documented PIPEDA statutory minimum where applicable.
