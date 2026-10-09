# Cross-account authorization prelaunch evidence

Validated 2026-10-09 from baseline `6283736df5be9a4d92a08bef0e84a427e915f89f` in a managed isolated worktree, branch `codex/cross-account-authorization`. No applicable AGENTS.md was present in the worktree or its ancestor directories.

## Changes and confirmed boundaries

- Activities: reads, listings, import duplicate detection, sport listings, deletion and imported-ID bookkeeping use the authenticated user ID in SQL. Two local PostgreSQL users with the same activity ID resolve their own records. Guessing an ID unique to the other user cannot retrieve activity/location/geography/context, look up landmarks, generate an image, or delete it. Request-body `userId` is ignored by route authorization.
- Posters, thumbnails and saved grounding: storage keys use the authenticated user prefix and safe poster IDs. Route tests reject anonymous reads and guessed cross-account IDs for metadata, PNG, WebP and saved references; favoriting, deletion, modification and variants also reject another user's poster. Owned reads and favoriting succeed. Image responses use `private, no-store`. Static `/data/posters/...` and `/posters/...` requests do not return the test image bytes.
- Public generation previously validated persisted images but could forward arbitrary `references` URLs when `persistReferences` was also supplied. Public `generatePoster` now validates every supplied reference as an inline image data URL before provider calls. Uploaded batches still resolve through the user's prefix. Edits and variants use a private helper for server-minted links after reading the owned source poster. This closes an unchecked outbound-reference input; it is not evidence that another account's private R2 objects were publicly accessible.
- Reference uploads: UUID batch IDs and manifests are resolved under `references/<user>/...`; another user guessing the batch cannot obtain bytes or mint signed links. Links expire after at most 24 hours and now also respect the remaining seven-day batch lifetime, rounded down to whole seconds. Expired batches are rejected before signing. Existing fake-credential presigner tests inspect the owner key, signature and `X-Amz-Expires` without contacting R2. Trace sanitization strips signing credentials.
- Jobs: ownership checks already exist for admission, listing, deduplication, retry and dismissal. A focused regression verifies that matching submission tokens do not replay another user's jobs; foreign activities/references are denied; retry/dismiss cannot change another owner's failed job; and worker generation receives the job owner. Queue production implementation is unchanged in this PR.
- Protected mutations: session lookup runs before dispatch. Every current protected mutation is covered by anonymous 401 and authenticated foreign-Origin 403 route tests. Middleware now rejects untrusted Origin values, including same-site siblings, and cross-site Fetch Metadata requests missing Origin. SameSite=Lax cookies and CORS remain defense in depth. Authless API routes are health and Better Auth routes; Better Auth's own origin/token checks are covered by the existing auth-flow tests. Authenticated non-browser clients without Origin/Fetch Metadata remain supported; this middleware does not authenticate clients through those headers.
- Sharing/download: sharing fetches the authenticated image and shares its file bytes. It now refuses unsuccessful HTTP responses, so an expired session's error body cannot become a shared image. It no longer falls back to sharing a protected API URL that recipients cannot open. File-share-unsupported browsers return false; downloads remain available. No public sharing endpoint or public poster capability is introduced.

## Validation

- `npm test`: **297 API tests and 201 web tests passed**, zero failures. Initial API run had one missing-fixture failure: `examples/canadian-routes/west-coast-trail.gpx` is ignored and absent from a fresh worktree. Copied the existing fixture from the primary checkout into this worktree, without committing it, then reran successfully.
- Final focused authorization/reference/sharing run: **10 tests passed**. This includes additional guessed-ID context/landmark/generation assertions added after the full-suite run.
- `node_modules/.bin/tsc -p apps/api/tsconfig.json`: passed after final test edits.
- `npm run build`: passed (web TypeScript and Vite); existing large-chunk warning remains.
- `git diff --check`: passed.

HTTP tests use the actual route registrations with an injected session lookup, real local PostgreSQL account lifecycle/queries and temporary local object storage. Existing auth-flow tests exercise Better Auth with its memory adapter. Job work and R2 interactions are test doubles; no paid image generation, customer email, cloud changes or deployment was performed. The API app factory prevents server/worker startup when imported for route tests; normal script execution retains startup behavior.

## Remaining launch checks and integration dependencies

Production bucket settings are **unverified** without account access. Code uses authenticated R2/S3 operations, scoped object keys and signed GETs, and sets no public ACL. Those facts do not prove that public bucket access, an `r2.dev` endpoint, a custom public domain or external policies are disabled. Verify public access is disabled for posters and reference objects, credentials are scoped appropriately, anonymous direct object requests fail, and signed requests actually expire against the production service. Signed URLs are bearer capabilities until expiry; possession allows access independently of the application session.

Seven-day reference expiry is application authorization, not proof of physical object deletion. Bucket lifecycle/expired-object cleanup and existing links after object/account deletion require service-level checks. Saved poster references and modification links have their own 24-hour signing lifetime.

The queue is changing in another chat. Merge/rebase integration must rerun `authorizationJobs.test.ts`, `authorization.test.ts`, account-deletion and job tests against the final queue implementation, including any persistence/multi-process retry paths. No broad queue rewrite or account-deletion reimplementation was included. No merge/deploy is authorized by this evidence.

Browser cookie behavior, actual signed-link expiry/public-access denial, authenticated HTTP sessions against deployed infrastructure, and real operating-system share-sheet compatibility remain unverified by these local tests.
