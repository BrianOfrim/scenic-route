# Sensitive generation logging — 2026-10-08

Generation-log redaction split out of the dependency advisory upgrades. Dependency manifests and the lockfile are unchanged here.

## Logging and secret exposure

- Trace request/response values fail closed: unknown strings, numbers, and booleans are redacted, including prompt/message content, personal names, coordinates, image bytes, and complete URLs. Recognized operational metadata retains model, lifecycle, status, duration, cost, phase, byte counts, concurrency, and transport codes.
- Arbitrary exception messages, socket addresses, unrelated properties, and stack traces are excluded from operational errors. Bounded nested causes and AggregateError codes remain useful for diagnosis.
- Trace-write failures print safe operational summaries, never full payloads. Console trace paths no longer expose account directory identifiers. Trace files retain account scoping and user IDs for existing account deletion semantics.
- Newly created trace directories and files request modes 0700 and 0600. Existing directory permissions and historical trace contents are not retroactively changed.
- Development auth-email fallback no longer prints email addresses or bearer verification/reset URLs. It records delivery as unconfigured. Production still rejects unconfigured delivery. No customer emails were sent.
- API database, startup, thumbnail, deletion, and generation-worker errors use safe structured logging. Gallery polling warnings avoid arbitrary error payloads.
- Inspected frontend source and environment usage: no frontend environment injections were found. A scan of tracked and built files for private-key markers, AWS key identifiers, common provider-key patterns, and real-looking signed URL signatures found no matches. No matching values were printed. Pattern scanning cannot prove absence of every possible credential format or inspect deployed assets.
- Existing ignored .env files and data were not committed. No retention or backup cleanup schedule was invented or configured.

## Validation

These checks were run on the combined branch before the dependency upgrades were split out:

- `npm test`: 295 API tests and 200 web tests passed. The clean-worktree test attempt had one pre-existing missing ignored fixture (`examples/canadian-routes/west-coast-trail.gpx`). That fixture was copied locally for validation only and is not part of this change.
- `npx tsc -p apps/api/tsconfig.json`: passed.
- `npm run build`: passed, including the frontend TypeScript build. The existing large-chunk warning remains.
- Redaction coverage includes nested private payloads, signed URLs, numeric coordinates, sanitizer idempotence, persisted trace privacy, private file permissions, write-failure fallback, preserved transport causes, and the auth-email fallback.
- `git diff --check`: passed.

## Integration and pending manual checks

This change does not alter queue behavior. `generationJobs.ts` only wraps the two worker error logs. Preserve those wrappers if integrating queue worker changes. `Gallery.tsx` only changes the polling warning callback.

Manual cloud access and MFA review, deployed frontend credential scan, production log and trace inspection, historical exposure assessment, existing trace-directory permissions, and backup/log access controls remain pending. No production or cloud accounts were changed. Retention periods require an approved decision; none were selected here. No deploy or merge was performed.
