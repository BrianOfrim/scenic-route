import type { SqlClient } from "./db";
export async function migrateImageJobs(client: SqlClient) {
    const globalLimit = Number(process.env.OPENROUTER_IMAGE_CONCURRENCY || 128);
    if (!Number.isSafeInteger(globalLimit) || globalLimit < 1 || globalLimit > 2147483647)
        throw new Error("Invalid initial OPENROUTER_IMAGE_CONCURRENCY");
    await client.query("BEGIN");
    try {
        await client.query(`
    CREATE TABLE IF NOT EXISTS image_schema_versions (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS image_deleting boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS image_scheduler (id int PRIMARY KEY CHECK(id = 1), enabled boolean NOT NULL DEFAULT true);
    ALTER TABLE image_scheduler ADD COLUMN IF NOT EXISTS global_limit int NOT NULL DEFAULT 128 CHECK(global_limit>0);

    CREATE TABLE IF NOT EXISTS image_owners (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      last_claim bigint NOT NULL DEFAULT 0
    );
    CREATE SEQUENCE IF NOT EXISTS image_claim_order;
    CREATE TABLE IF NOT EXISTS image_submissions (
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      submission_id text NOT NULL, fingerprint text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), terminal_at timestamptz,
      PRIMARY KEY(user_id, submission_id)
    );
    CREATE TABLE IF NOT EXISTS image_workers (
      id text PRIMARY KEY, draining boolean NOT NULL DEFAULT false,
      heartbeat_at timestamptz NOT NULL DEFAULT now(), role text NOT NULL
    );
    CREATE SEQUENCE IF NOT EXISTS image_job_order;
    CREATE TABLE IF NOT EXISTS image_jobs (
      id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      submission_id text NOT NULL, payload_version int NOT NULL DEFAULT 1,
      work jsonb NOT NULL, details jsonb NOT NULL,
      state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','generating','completed','failed')),
      attempt_no int NOT NULL DEFAULT 0, retry_count int NOT NULL DEFAULT 0,
      retry_at timestamptz NOT NULL DEFAULT now(), retry_allowed_at timestamptz,
      attempt_id uuid, error text, failure_reason text, dismissed boolean NOT NULL DEFAULT false,
      result_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE image_jobs ADD COLUMN IF NOT EXISTS queue_sequence bigint NOT NULL DEFAULT nextval('image_job_order');
    CREATE INDEX IF NOT EXISTS image_jobs_owner_state ON image_jobs(user_id,state);
    CREATE INDEX IF NOT EXISTS image_jobs_ready ON image_jobs(retry_at,created_at) WHERE state='queued';
    CREATE INDEX IF NOT EXISTS image_jobs_submission ON image_jobs(user_id,submission_id);
    CREATE TABLE IF NOT EXISTS image_attempts (
      id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES image_jobs(id) ON DELETE CASCADE,
      user_id text NOT NULL, worker_id text NOT NULL,
      phase text NOT NULL DEFAULT 'preparing', lease_until timestamptz NOT NULL,
      capacity_until timestamptz NOT NULL, dispatched_at timestamptz,
      quota_id text REFERENCES poster_generation_usage(id) ON DELETE SET NULL,
      output_count int, manifest_ready boolean NOT NULL DEFAULT false,
      poster_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
      terminal_at timestamptz
    );
    ALTER TABLE image_attempts ADD COLUMN IF NOT EXISTS execution_token uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE image_attempts ADD COLUMN IF NOT EXISTS output_stamp text;
    CREATE INDEX IF NOT EXISTS image_attempts_capacity ON image_attempts(capacity_until,user_id);
    CREATE TABLE IF NOT EXISTS image_objects (
      attempt_id uuid NOT NULL REFERENCES image_attempts(id) ON DELETE CASCADE,
      name text NOT NULL, verified boolean NOT NULL DEFAULT false,
      bytes bigint NOT NULL, sha256 text NOT NULL,
      PRIMARY KEY(attempt_id,name)
    );
    ALTER TABLE image_objects ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
    ALTER TABLE image_objects ADD COLUMN IF NOT EXISTS upload_until timestamptz;
    CREATE TABLE IF NOT EXISTS image_records (
      attempt_id uuid NOT NULL REFERENCES image_attempts(id) ON DELETE CASCADE,
      poster_id text NOT NULL, record jsonb NOT NULL, PRIMARY KEY(attempt_id,poster_id)
    );
    CREATE TABLE IF NOT EXISTS poster_publications (
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      poster_id text NOT NULL, object_prefix text NOT NULL DEFAULT '', record jsonb NOT NULL,
      attempt_id uuid REFERENCES image_attempts(id) ON DELETE SET NULL,
      PRIMARY KEY(user_id,poster_id)
    );
    CREATE TABLE IF NOT EXISTS image_storage_attempts (
      attempt_id uuid PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS image_cleanup (
      user_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
      checked_at timestamptz, error text
    );
    INSERT INTO image_schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;
  `);
        await client.query("INSERT INTO image_scheduler(id,global_limit) VALUES(1,$1) ON CONFLICT DO NOTHING", [globalLimit]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
