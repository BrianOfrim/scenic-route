# Import input hardening — prelaunch evidence

Validated 2026-10-09 in the managed isolated worktree on `codex/import-input-hardening`, initially based on the requested `6283736df5be9a4d92a08bef0e84a427e915f89f`. Before publication, the import commit was rebased onto `main` at `961d49ae49a9b8c7ea61abc1830916fcaf8487ae` to exclude the already-merged account-pool change from the PR diff. `git diff --exit-code 4d04eac HEAD -- apps package-lock.json` confirmed the validated implementation was unchanged by the rebase.

## Changes and bounded limits

- Request bodies are counted before JSON or multipart parsing, including chunked uploads and dishonest Content-Length. Maximum body: 350 MiB, allowing a 250 MiB ZIP encoded as base64 plus overhead. Oversized bodies return HTTP 413; stalled body reads are cancelled after five minutes.
- Existing upload limits remain: 256 files, 15 MiB per individual/compressed activity, 250 MiB per ZIP. Excess-file reporting is bounded to one summary error while retaining the first 256 inputs. Base64 is validated and decoded size checked before allocation.
- ZIPs allow stored/DEFLATE entries, streaming data descriptors, nested export folders, Unicode filenames, and activities.csv. Selected entries have a 64 MiB actual-output limit. Actual output is capped inside zlib rather than trusting ZIP size metadata. CRC, expanded size, central/local filename and compression consistency, and directory bounds are checked. Unrelated media is not inflated.
- Existing archive limits are retained and extended across the entire request: 20,000 ZIP entries; 512 MiB of selected archive-entry bytes plus decoded track bytes; at most 5,000 expanded activities. Counting both intermediate archive storage and decoded tracks intentionally makes the budget conservative. CSV is limited to 20,000 metadata rows plus its header, and unterminated quoted fields fail.
- ZIP and CSV paths reject parent traversal, absolute paths, drive paths, NULs, and normalized duplicate archive names. Backslash-separated safe paths remain supported. Nothing is extracted to filesystem paths.
- GPX/TCX now undergo strict SAX XML validation before existing route parsing. DTDs, malformed XML, more than 128 levels of nesting, and more than 250,000 GPS point elements fail clearly. Comments and CDATA cannot introduce fake route markup. Missing/empty coordinates do not become (0,0).
- FIT files require header/file integrity and successful decoding. Decoding stops above 500,000 messages. Existing normal FIT tracks still pass.
- The authenticated import endpoint permits six admitted attempts per account per minute and one active import per process. It returns HTTP 429 with Retry-After before parsing rejected requests. Capacity is released in finally, including parsing/import failures. Limiter state is bounded to 10,000 accounts and idle entries expire. One active import is a conservative backstop for the configured one-CPU, 1 GiB instance.
- Uploads, archive entries, and decoded data stay in memory. Oversized/stalled/rejected request streams are cancelled, reader locks and deadline timers released, and the admission slot released. Import handling creates no temporary upload files needing disk cleanup. Successful activities and per-file errors retain the existing partial-result behavior.

## Validation

Node v26.8.2, npm-installed pinned dependencies. Persistence tests used a disposable `postgres:16-alpine` container bound only to 127.0.0.1:55432 with its own `scenic_import_test` database; no shared app database or cloud account was modified.

- 64 import/parser/security/auth tests passed:
  `DATABASE_URL=<isolated test database> node --import tsx --test apps/api/src/importSecurity.test.ts apps/api/src/archive.test.ts apps/api/src/gpx.test.ts apps/api/src/fit.test.ts apps/api/src/tcx.test.ts apps/api/src/importRequest.test.ts apps/api/src/importActivity.test.ts apps/api/src/authRequired.test.ts`
- New adversarial fixtures exercise forged ZIP sizes, output/aggregate/entry limits, bad CRCs and truncation, central/local path disagreement, ZIP/CSV traversal, normalized duplicates, gzip expansion and concatenated members, shared nested-expansion budgets, excessive CSV rows, chunked/dishonest requests, stream cancellation/deadlines, malformed XML/DTD/depth/point bounds, FIT corruption/message limits, HTTP 413/429/Retry-After, limiter expiration/release, bounded JSON error reporting, and partial-result preservation. Bomb fixtures inflate only 8 KiB using small test limits; the point-count fixture is approximately 2 MiB.
- Successful ZIP data-descriptor/Unicode imports, compressed GPX Strava export CSV metadata, and loose gzip FIT/TCX files are tested. Seven persistence tests passed, including the existing duplicate/re-import identity regressions.
- `./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` passed.
- `npm run test:web`: all 200 tests passed.
- `npm run build` passed (existing Vite large-chunk advisory).
- `git diff --check` passed.
- The ignored West Coast Trail regression fixture was copied from the primary checkout into the isolated worktree for testing; it is not part of the change.

## Integration and remaining limitations

The separate queue implementation is pending. This branch only moves the import route handler out of index.ts and hardens import admission; it does not replace or modify requestQueue or generationJobs. Preserve the queue chat's changes when combining branches. If upload work is later queued, acquire these controls before reading the body and release only after parsing/import completes, or replace them with equivalent shared limits.

Admission/rate state is process-local and resets on restart. Multi-replica enforcement requires a gateway/shared limiter; that production integration is outside this PR. Upload parsing still buffers bounded bodies; size caps are not a strict heap/CPU guarantee. Maximum-size exports on the configured 1 GiB machine still need deployment-specific load testing and may require streaming parsing, worker isolation, or smaller configured caps. No maximum-size production load test was performed. Node 22 is the Docker target; this local run used Node 26, so target-runtime CI remains relevant. ZIP64, split/encrypted ZIPs and compression methods other than stored/DEFLATE are deliberately rejected with clear errors. Limits may reject unusually large otherwise-valid activity files or exports; users can split batches.

No merge, deployment, customer email, or production/cloud-account change was performed.
