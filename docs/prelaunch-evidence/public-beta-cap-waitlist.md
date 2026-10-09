# Public beta capacity and waitlist evidence

Base: 6283736df5be9a4d92a08bef0e84a427e915f89f. Branch: codex/public-beta-waitlist.
Implemented in an attached isolated managed worktree. No production accounts, cloud settings, deployments, or customer email deliveries were changed.

## Behavior and accounting

The free public beta admits at most 100 ordinary accounts through a PostgreSQL row counter and user-table trigger. Password and Google authentication both create the same user rows, so neither depends on an HTTP preflight check. A database transaction reserves a place when it inserts an admitted user; concurrent inserts and operator admissions serialize on the counter row. Transaction rollback refunds the reservation automatically.

Existing ordinary users are admitted and counted when the migration runs, including unverified accounts. New unverified accounts also count. Once full, new accounts are saved with beta_status=waiting; verification/sign-in still work. An account is counted once regardless of linked auth methods. Deleting a counted account refunds its place; deleting a waiting or exempt account does not. Freed capacity does not automatically promote anyone. Migration is transactional and repeatable.

The migration preserves existing accounts. If more than 100 ordinary accounts already exist, the initial counter reflects that number and all new ordinary signups wait; admissions remain blocked until usage is below 100. Confirm the prelaunch count is <=100 before release. This PR does not silently revoke existing access.

Authenticated GET /api/beta returns only the caller's status and cap, without emails, account counts, or waitlist membership lists. All other application API routes return 403 BETA_WAITLISTED for waiting users before bootstrap or route execution, except DELETE /api/account. Authentication, profile changes, verification, password recovery, and sign-out remain available. Account lifecycle access also blocks waitlisted background workers by default. The explicitly allowed auth/middleware paths pass allowWaiting=true and perform their own route checks.

Signup explains capacity for email and Google. After verification/login, waiting users see a dedicated waitlist page with access refresh, sign-out, and account settings/deletion. They do not load activity or poster data.

## Operator runbook

Use a trusted machine with database credentials pointing at the intended database. This is a local operator CLI, with no public admission endpoint or account-list endpoint.

- Admit an existing waitlisted account: npm run beta:admit -- user@example.com
- Explicitly exempt Brian's operator account: set BETA_OPERATOR_USER_ID to Brian's exact existing user ID, then npm run beta:admit -- brian@example.com --exempt-operator
- Exemption requires both the configured exact ID and matching email. The CLI cannot exempt a different account merely by supplying its email.
- A full ordinary beta rejects admission and exits nonzero. Concurrent CLI admissions cannot exceed capacity. Repeated admission of the same account is idempotent.
- The CLI sends no invitation or other email. Informing a user requires a separate explicit operator action outside this implementation; they can check access by signing in.
- Do not disable triggers, TRUNCATE the user table, or directly edit beta_capacity during normal operations. Restore/reconcile both user admission state and the counter together in database recovery.

## Validation (2026-10-08; final checks repeated 2026-10-09)

- Seven beta integration tests passed against a freshly created disposable local PostgreSQL database, removed afterward.
- Coverage: existing/unverified account migration and repeatability; 12 competing password/Google signups for the last place; both auth methods admitted when room and waiting when full; ignored client exemption/status fields; returning Google retains one place; concurrent operator admissions; deletion/refund accounting; explicit configured operator exemption and rejected mismatches via the real CLI; rollback refunds; self-only status; blocked import/generation/jobs/retry/variant/planning/read/admission routes; admitted route access; waitlisted background worker exclusion; waiting account deletion access.
- Full API suite: 297 passed, one existing fixture failure. West Coast Trail segments stitch without the five long jumps fails ENOENT because examples/canadian-routes/west-coast-trail.gpx is absent from this checkout and the primary checkout. No replacement fixture was fabricated.
- Web suite: 200 passed.
- API TypeScript: tsc -p apps/api/tsconfig.json passed.
- Production web build: npm run build passed (existing Vite large-chunk warning).
- git diff --check passed.
- Google token signature verification is mocked in integration tests, as in existing auth tests. No live Google credentials or customer mail delivery were used. Live OAuth callback behavior and responsive browser appearance still need release smoke testing.

## Integration dependencies

Eligibility/consent is merged with this admission gate. Eligibility must complete before app access; beta admission does not establish consent. Waitlisted accounts can still read `/api/beta`, record participation, and delete the account so the consent screen and waitlist page can load. Other application routes stay waitlisted before bootstrap. `beta_status` and `beta_exempt` intentionally are not Better Auth additionalFields and cannot be supplied by auth request bodies.

The separate queue/fair-scheduling PR may modify lifecycle/worker handling. Preserve the default waitlist rejection in withAccountAccess and its 403 AccountUnavailableError, along with owner scoping and deletion locks. Worker callers retain the default allowWaiting=false; only auth and request middleware use the override. Re-run beta, auth, account deletion, queue and generation tests after integration. No queue implementation was replaced or reverted in this PR.

The fixed 100 cap counts account rows, not unique natural people. Existing password verification and auth abuse protections still apply; no expiration/reclamation of unverified reservations is introduced here.
