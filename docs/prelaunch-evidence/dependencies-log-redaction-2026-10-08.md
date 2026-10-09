# Dependency advisories and sensitive logging — 2026-10-08

Base: `6283736df5be9a4d92a08bef0e84a427e915f89f`. Work done in attached managed worktree on `codex/prelaunch-dependencies-log-redaction`.

## Advisory review and fixes

Current npm registry audit and GitHub reviewed advisory sources were checked on October 8, 2026.

- Production audit initially reported MapLibre GL JS critical attribution sanitizer bypass, [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579), affecting versions through 6.4.0. Upgraded locked 5.24.0 to 6.13.0; the manifest now requires ^6.13.0.
- Production audit initially reported Sharp high-severity librsvg issue, [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), affecting versions below 0.35.5. Upgraded Sharp and corresponding platform binaries to 0.35.5 and bundled libvips packages to 1.3.4.
- Full audit additionally reported development-tool advisories: [shell-quote command injection](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) and [source-map-js denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Compatible lockfile fixes updated concurrently to 9.2.5, shell-quote to 1.12.0, and source-map-js to 1.2.2.
- Final `npm audit --omit=dev --json` and `npm audit --json`: zero reported vulnerabilities at every severity. Audit results reflect known advisories at review time, not a comprehensive security assessment.

## Logging and secret exposure

- Trace request/response values fail closed: unknown strings, numbers and booleans are redacted, including prompt/message content, personal names, coordinates, image bytes and complete URLs. Recognized operational metadata retains model, lifecycle, status, duration, cost, phase, byte counts, concurrency and transport codes.
- Arbitrary exception messages, socket addresses, unrelated properties and stack traces are excluded from operational errors; bounded nested causes and AggregateError codes remain useful for diagnosis.
- Trace-write failures print safe operational summaries, never full payloads. Console trace paths no longer expose account directory identifiers. Trace files retain account scoping and user IDs for existing account deletion semantics.
- Newly created trace directories/files request modes 0700/0600. Existing directory permissions and historical trace contents are not retroactively changed.
- Development auth-email fallback no longer prints email addresses or bearer verification/reset URLs. It records delivery as unconfigured; production still rejects unconfigured delivery. No customer emails were sent.
- API database, startup, thumbnail, deletion and generation-worker errors use safe structured logging. Gallery polling warnings avoid arbitrary error payloads.
- Inspected frontend source/environment usage: no frontend environment injections were found. Scanned 494 tracked/built files for private-key markers, AWS key identifiers, common provider-key patterns and real-looking signed URL signatures; zero matches. No matching values were printed. Pattern scanning cannot prove absence of every possible credential format or inspect deployed assets.
- Existing ignored .env files and data were not committed. No retention or backup cleanup schedule was invented or configured.

## Validation

- `npm test`: 295 API tests and 200 web tests passed. Initial clean-worktree test attempt had one pre-existing missing ignored fixture (`examples/canadian-routes/west-coast-trail.gpx`); copied the existing primary-checkout fixture into this worktree for local validation only. The fixture remains ignored and is not part of this PR.
- `npx tsc -p apps/api/tsconfig.json`: passed.
- `npm run build`: passed (includes frontend TypeScript build); existing large-chunk warning remains, with largest chunk about 1.07 MB before gzip.
- Redaction coverage includes nested private payloads, signed URLs, numeric coordinates, sanitizer idempotence, persisted trace privacy, private file permissions, write failure fallback, preserved transport causes and auth-email fallback.
- `git diff --check`: passed.

## Integration and pending manual checks

Queue changes are pending in a separate chat. This PR does not alter queue behavior. Its generationJobs.ts edits only wrap the two worker error logs; preserve those wrappers if integrating queue worker changes. Gallery.tsx only changes the polling warning callback. Resolve overlapping changes by keeping the final queue implementation and safe logging, then rerun the relevant tests.

Manual cloud access/MFA review, deployed frontend credential scan, production log/trace inspection, historical exposure assessment, existing trace-directory permissions and backup/log access controls remain pending. No production/cloud accounts were changed. Retention periods require an approved decision; none were selected here.

MapLibre is a major-version upgrade: compile and map/poster tests pass, but an interactive browser smoke test of live maps, custom styles, attribution and schematic exports remains pending. No deploy or merge was performed.
