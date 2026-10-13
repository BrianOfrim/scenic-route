# Database and image recovery

Operator: Brian Ofrim. The repository does not establish that production backups or a full restore have been verified. Confirm actual Neon recovery points and independent R2 backups before relying on them. An app image or tile-cache snapshot cannot restore customer data.

## Capture a consistent recovery point

Record privately the database and bucket identities, available recovery window, snapshot time, source PostgreSQL version, backup destination, and last successful restore test. Use restricted credentials and encrypted storage; backups include GPS and authentication data.

Pause new image submissions, finish accepted jobs, and drain workers using [image-workers.md](image-workers.md). Then block all other public writes and stop API/worker processes, including cleanup, before capturing both stores. Admission pause alone does not stop imports, uploads, account deletion, or background cleanup. Record the quiescence time. `pg_dump` is database-consistent but is not an atomic R2 snapshot.

With privately configured source libpq variables and read-only R2 credentials:

```sh
umask 077
mkdir -p "$BACKUP_DIR/objects"
pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_DIR/database.dump"
pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database.contents"
aws --profile "$R2_SOURCE_PROFILE" --endpoint-url "$R2_SOURCE_ENDPOINT" s3 cp "s3://$SOURCE_BUCKET/posters/" "$BACKUP_DIR/objects/posters/" --recursive
aws --profile "$R2_SOURCE_PROFILE" --endpoint-url "$R2_SOURCE_ENDPOINT" s3 cp "s3://$SOURCE_BUCKET/references/" "$BACKUP_DIR/objects/references/" --recursive
```

Use `pg_dump` compatible with the source server. Keep passwords out of command lines and recordings. Preserve all original keys, including `posters/<userId>/_attempts/` paths referenced by published posters, metadata, thumbnails, saved references, and any legacy objects. Do not filter objects merely because their directory name says “attempts.”

Capture a fully paginated object manifest with sizes, content types, and metadata; hash downloaded bytes and reconcile counts. ETags are not universal byte hashes. Keep the matched database/object pair immutable. Do not mirror deletions into the only backup. Reference-batch expiry is not renewed by restoration. Diagnostic traces have a separate retention/evidence purpose; the OSM cache is rebuildable.

Neon point-in-time restoration covers the database, not R2 deletions. Verify the actual recovery window and pair any restored database point with compatible objects. Use maintained [Neon restore documentation](https://neon.com/docs/postgres/backup-restore/branch-restore), [PostgreSQL pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html), and [R2 AWS CLI documentation](https://developers.cloudflare.com/r2/examples/aws/aws-cli/).

## Restore into isolation first

1. Create an empty private test database and bucket with separate restricted credentials. Do not load production `.env.local` or production write credentials. Omit mail, Google, and paid-provider credentials.
2. Restore the database using test libpq variables:

   ```sh
   pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$RESTORE_DATABASE_NAME" "$BACKUP_DIR/database.dump"
   ```

3. Restore objects with their original keys, content types, and metadata. Verify counts, sizes, and downloaded hashes against the manifest.
4. Inspect account ownership, activities, quota, beta capacity, migration markers, durable jobs/attempts, cleanup records, and `poster_publications`. Ensure each publication points to complete restored objects. Reconcile account deletions and writes since the recovery point; do not resurrect deleted accounts.
5. Before running workers, disable image admission and prevent restored queued jobs from dispatching. Start only the API role for initial checks. Run reviewed migration/backfill explicitly with `npm run jobs:migrate`; runtime roles normally have migrations disabled. Compare database/object manifests before and after migration, preserving the immutable backup.
6. Verify scoped activities, Gallery records, original/thumbnail downloads, and saved references without paid generation or mail. Use synthetic users for access checks; do not reuse customer sessions.
7. Record the recovered point, duration, counts/hashes, discrepancies, missing objects, and app compatibility. A readable dump listing is not proof of a successful restore.

Promotion to production requires choosing the recovery point, reconciling lost/newer writes and deletion requests, and verifying both stores. Preserve the original incident state until acceptance. Follow [operations.md](operations.md) to verify the recovered release and restore the prior admission setting.
