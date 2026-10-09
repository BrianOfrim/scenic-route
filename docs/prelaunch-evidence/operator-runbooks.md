# Operator runbooks evidence

Date: 2026-10-08 (America/Edmonton). Owner: Brian Ofrim, Alberta, Canada, info@scenic-route.ca. Baseline `6283736df5be9a4d92a08bef0e84a427e915f89f`; branch `codex/operator-runbooks`, attached managed worktree. Shared primary checkout preserved.

## Implemented

Documentation only: [release/rollback, restart, smoke and monitoring](../runbooks/operations.md), [matched database/image backup and isolated recovery](../runbooks/recovery.md), [privacy/security incident decisions](../runbooks/privacy-incident.md), README discovery links. No production changes, real email, monitoring provisioning or paid image generation. No UI restart change: jobs API lacks a boot/interruption signal, and disappeared jobs also represent completion/expiry/dismissal. Documented customer template and architectural gap rather than claiming durable recovery.

Inspected Dockerfile, fly.toml, docker-compose.yml, API startup, DB migrations/SQLite import, file-first destructive purge, bootstrap ownership migration, local/R2 storage, reference uploads, jobs/provider queues, quota and browser job polling. Runbooks describe actual baseline defaults separately from pending approved queue target (100 globally/four per user/eight waiting).

Official sources consulted: Fly deploy command reference; PostgreSQL pg_dump; Cloudflare R2 AWS CLI; Neon's maintained branch-restore documentation; Alberta OIPC breach requirements; Canadian OPC breach guidance and privacy-law overview; FTC breach-response/health-rule guidance; California Attorney General reporting guidance. Direct links appear beside the relevant procedures. Canadian and US applicability remains an incident-specific decision, not a legal clearance.

## Local checks performed

- `npm ci --ignore-scripts` succeeded using lockfile in isolated worktree. Installer reported five dependency vulnerabilities (two high, three critical); no package changes or audit remediation undertaken in this docs task.
- Focused tests: `DATABASE_URL=postgres://scenic:scenic@127.0.0.1:55437/runbooks node_modules/.bin/tsx --test apps/api/src/requestQueue.test.ts apps/api/src/generationJobs.test.ts apps/api/src/storage.test.ts apps/api/src/referenceUploads.test.ts apps/api/src/authRequired.test.ts apps/api/src/posterQuota.test.ts apps/web/src/gallery/generationState.test.ts` — **40 passed, zero failed**. Disposable Postgres 16 container, separate database/port; mocked provider/storage tests do not prove production backup availability.
- API booted on local port 18793 against that disposable DB with zero env files loaded and local storage, without provider/email credentials. Anonymous requests: `/api/health` 200 `{"ok":true}`; `/api/auth/config` 200 `{"google":false}`; `/api/activities` 401 `{"error":"sign in required"}`.
- After stopping only disposable Postgres, the same initialized API still returned health 200 `{"ok":true}`. Confirms documented limitation: cached `initDb()` health does not check fresh DB availability. No health implementation changed.
- Documentation whitespace and local Markdown-link checks passed. No application code changed; full build/test suite not rerun for this documentation-only change.

## Production-only / not performed

No production health request, Fly deployment/rollback, production account action, external alert delivery test, production DB snapshot, R2 backup, Neon restore-window inventory or full backup restore was performed. **Backup availability, recoverability and RPO/RTO remain unverified.** A fresh disposable DB used for endpoint checks is not a restored backup.

Brian must verify sole API machine, deployed queue version, matching independent snapshots, isolated DB/object restore and deletion reconciliation, maintenance/drain mechanism, previous-image compatibility, smoke flows and monitoring alert routing before marking those operational controls complete. No new log/backup retention schedules approved. Incident records have the separately documented PIPEDA statutory minimum where applicable.
