# Database and image recovery rehearsal

Owner: Brian Ofrim, Alberta, Canada; info@scenic-route.ca. **Production backups and restore have not been verified.** Neon recovery depends on actual project plan/configuration; R2 live storage is not proof of an independent backup. Never assume deleted/overwritten objects are recoverable.

## Inventory and backup

Record privately: Neon project/branch/database, source Postgres major version, available restore points/window, R2 account/bucket/endpoint, prefixes, independent backup destination/access, last successful capture, measured recovery duration and point. Restrict access and encrypt private backups: they contain GPS, identity/auth and image data. Brian approves cadence/retention separately; none is set here.

`storage.ts` uses `posters/<userId>/<name>`: preserve every sibling (metadata JSON, original, thumbnail and saved references), key and content type. `referenceUploads.ts` uses separate `references/` batch metadata/images; include still-valid batches and any legacy unscoped keys. Restoring does not renew batch expiry. Existing seven-day reference expiry/lifecycle guidance is not a backup policy. OSM cache is rebuildable; traces are sensitive diagnostics, not recoverable jobs.

1. Stop public writes and background work using [operations.md](operations.md). Record UTC quiescence time. `pg_dump` is DB-consistent, not an atomic R2 snapshot; a pair captured during writes is not verified consistent.
2. Use pg_dump compatible with source server (not an older major). Configure direct TLS-enabled source libpq variables privately and a read-only R2 AWS CLI profile. Keep URLs/passwords out of terminal recordings; prefer `.pgpass`/secret manager. Example capture:

```bash
# Privately set source PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLMODE and task variables.
umask 077
mkdir -p "$BACKUP_DIR/objects"
pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_DIR/database.dump"
pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database.contents"
aws --profile "$R2_SOURCE_PROFILE" --endpoint-url "$R2_SOURCE_ENDPOINT" s3 cp "s3://$SOURCE_BUCKET/posters/" "$BACKUP_DIR/objects/posters/" --recursive
aws --profile "$R2_SOURCE_PROFILE" --endpoint-url "$R2_SOURCE_ENDPOINT" s3 cp "s3://$SOURCE_BUCKET/references/" "$BACKUP_DIR/objects/references/" --recursive
```

3. Capture a fully paginated source manifest of keys, sizes, content types and relevant metadata; hash downloaded bytes with SHA-256 and reconcile counts/files. CLI downloads do not preserve all content-type metadata: keep the manifest for uploads. ETags are not universal byte hashes. Include legacy keys if present. Record exit codes/incomplete transfers. Copy/encrypt the immutable matched pair to Brian's approved independent destination and verify read access. Never mirror deletions into the only backup with `sync --delete`.
4. If using Neon point-in-time recovery, confirm the desired pre-change point exists within the actual window; create a separate recovery branch/endpoint, preserving source. Pair it with matching objects: Neon cannot restore R2 deletions. See [maintained Neon branch restore docs](https://github.com/neondatabase/website/blob/main/content/docs/postgres/backup-restore/branch-restore.md).

References: [Postgres pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [R2 AWS CLI](https://developers.cloudflare.com/r2/examples/aws/aws-cli/).

## Isolated restore and acceptance

1. Create an empty disposable private database and **new private test bucket**. Separate credentials must be restricted to test destinations. Verify endpoints/names twice. No production `.env.local`, DB URL or R2 write credential may be loaded. Use development mode, localhost origins, omit Resend/Google/OpenRouter credentials and restrict egress to local DB/test storage. Do not make the bucket public.
2. Set libpq variables to the verified test destination and restore:

```bash
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$RESTORE_DATABASE_NAME" "$BACKUP_DIR/database.dump"
```

3. Restore all objects using original keys and captured content types/metadata. Use test profile/endpoint and per-object `aws s3api put-object --bucket ... --key ... --body ... --content-type ...`. Verify counts, sizes and downloaded SHA-256 against backup for both prefixes. Do not guess PNG: thumbnails are WebP, metadata JSON, and references may differ. Handle keys as data without shell reinterpretation.
4. Before startup compare counts for `"user"`, `account`, `session`, `activities`, `settings`, `activity_file_ids`, `poster_generation_usage`; inspect tenancy PK/indexes and migration/bootstrap markers. Restored sessions/tokens/hashes are sensitive; never use customer sessions for testing.
5. Launch intended release against only test DB/bucket. Startup migrates/purges: compare before/after row/object manifests and logs. Start twice to check unexpected repeated changes. Preserve immutable backup for trying the last good image.
6. Verify localhost health, anonymous protected endpoints, synthetic-user isolation, activity geometry, gallery metadata, original/thumbnail downloads and references. No paid generation or mail. Brian performs any required real-data review privately. Reconcile account-deletion history before acceptance to avoid resurrecting accounts.
7. Record snapshot time, recovered point, duration, counts/hashes, discrepancies, missing objects, app compatibility and pass/fail. A readable dump listing is not a restore. Missing object backups block recovery of affected images; record the gap instead of promising recovery.

Acceptance requires both stores passing integrity checks and app startup/smoke checks. Production promotion, endpoint/secret changes and reopening traffic are separate Brian-approved operations. Preserve incident state and explicitly assess loss since the recovery point.
