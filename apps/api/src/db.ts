import fs from "node:fs";
import pg from "pg";
import { migrateBetaAdmission } from "./betaMigration";
import { DB_PATH } from "./paths";

const { Pool, types } = pg;

types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

export type SqlClient = Pick<pg.Pool | pg.PoolClient, "query">;

export const PENDING_USER_ID = "__pending__";

const DEFAULT_DATABASE_URL = "postgres://scenic:scenic@127.0.0.1:5432/scenic_route";

let pool: pg.Pool | null = null;
let ready: Promise<pg.Pool> | null = null;

export function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

export function databaseUrlSource() {
  if (process.env.DATABASE_URL?.trim()) return "DATABASE_URL";
  return "default local";
}

function redactUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  } catch {
    return "postgres";
  }
}

async function queryOn<T>(client: SqlClient, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

export async function query<T>(sql: string, params: unknown[] = [], client?: SqlClient): Promise<T[]> {
  return queryOn<T>(client ?? (await getPool()), sql, params);
}

export async function queryOne<T>(
  sql: string,
  params: unknown[] = [],
  client?: SqlClient,
): Promise<T | undefined> {
  const rows = await query<T>(sql, params, client);
  return rows[0];
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await (await getPool()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPool() {
  if (!ready) {
    ready = (async () => {
      const created = new Pool({ connectionString: databaseUrl() });
      created.on("error", (error) => {
        console.error("postgres pool error", error);
      });
      try {
        await waitForPostgres(created);
        const migration = await created.connect();
        try {
          // Multiple API/test processes can initialize together. Serialize DDL,
          // including CREATE TABLE IF NOT EXISTS, which can still race in Postgres.
          await migration.query("SELECT pg_advisory_lock(hashtextextended('scenic-route:migrations', 0))");
          await migrate(migration);
        } finally {
          try { await migration.query("SELECT pg_advisory_unlock(hashtextextended('scenic-route:migrations', 0))"); }
          finally { migration.release(); }
        }
        try {
          await maybeImportSqlite(created);
        } catch (error) {
          console.warn("sqlite import skipped", error instanceof Error ? error.message : error);
        }
      } catch (error) {
        await created.end().catch(() => undefined);
        ready = null;
        pool = null;
        throw error;
      }
      pool = created;
      return created;
    })();
  }
  return ready;
}

export async function initDb() {
  try {
    await getPool();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Postgres is not reachable at ${redactUrl(databaseUrl())}. Start it with \`docker compose up -d\` and set DATABASE_URL. ${message}`,
    );
  }
}

async function waitForPostgres(client: SqlClient, attempts = 20) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await client.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function migrate(client: SqlClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      "type" TEXT NOT NULL,
      sport_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      distance DOUBLE PRECISION NOT NULL,
      moving_time INTEGER,
      elapsed_time INTEGER,
      total_elevation_gain DOUBLE PRECISION,
      average_speed DOUBLE PRECISION,
      max_speed DOUBLE PRECISION,
      trainer INTEGER NOT NULL DEFAULT 0,
      has_gps INTEGER NOT NULL DEFAULT 0,
      streams_synced INTEGER NOT NULL DEFAULT 0,
      latlng TEXT,
      "time" TEXT,
      velocity TEXT,
      altitude TEXT,
      bbox TEXT,
      route_breaks TEXT,
      segment_efforts TEXT,
      source TEXT NOT NULL DEFAULT 'gpx',
      imported INTEGER NOT NULL DEFAULT 1,
      origin TEXT NOT NULL DEFAULT 'upload',
      file_format TEXT NOT NULL DEFAULT 'gpx',
      external_id TEXT,
      content_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS activities_streams_synced ON activities (streams_synced);
    CREATE INDEX IF NOT EXISTS activities_start_date ON activities (start_date);

    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL,
      image TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMPTZ,
      "refreshTokenExpiresAt" TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ DEFAULT now(),
      "updatedAt" TIMESTAMPTZ DEFAULT now()
    );

  `);

  await migrateBetaAdmission(client);
  await client.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS image_limits JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(image_limits) = 'object')`);
  await client.query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS poster_monthly_limit INTEGER DEFAULT 50 CHECK (poster_monthly_limit >= 0)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS poster_generation_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      month DATE NOT NULL,
      reserved INTEGER NOT NULL CHECK (reserved > 0),
      generated INTEGER CHECK (generated >= 0 AND generated <= reserved),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS poster_generation_usage_user_month
      ON poster_generation_usage (user_id, month);
  `);

  await client.query(`
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS eligibility_blocked BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS participation_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('eligibility', 'terms', 'ai')),
      version TEXT NOT NULL,
      accepted BOOLEAN NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS participation_events_user_kind ON participation_events (user_id, kind, id DESC);
  `);

  await ensureActivitiesTenancy(client);
  await ensureColumn(client, "activities", "segment_efforts", "TEXT");
  await ensureColumn(client, "activities", "route_breaks", "TEXT");
  await ensureColumn(client, "activities", "source", "TEXT NOT NULL DEFAULT 'gpx'");
  await client.query("ALTER TABLE activities ALTER COLUMN source SET DEFAULT 'gpx'");
  if (await ensureColumn(client, "activities", "imported", "INTEGER NOT NULL DEFAULT 0")) {
    await client.query(
      `UPDATE activities SET imported = 1
       WHERE source IN ('gpx', 'fit', 'tcx') OR id >= 2000000000000`,
    );
    const tokens = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = $1",
      ["strava_tokens"],
      client,
    );
    if (!tokens) await client.query("UPDATE activities SET imported = 1");
  }
  await client.query("ALTER TABLE activities ALTER COLUMN imported SET DEFAULT 1");
  const addedOrigin = await ensureColumn(client, "activities", "origin", "TEXT NOT NULL DEFAULT 'upload'");
  const addedFormat = await ensureColumn(client, "activities", "file_format", "TEXT NOT NULL DEFAULT 'gpx'");
  const addedExternalId = await ensureColumn(client, "activities", "external_id", "TEXT");
  await ensureColumn(client, "activities", "content_hash", "TEXT");
  if (addedOrigin || addedFormat || addedExternalId) {
    await client.query(`
      UPDATE activities
      SET origin = CASE WHEN source = 'strava' AND imported = 1 THEN 'archive' ELSE 'upload' END,
          file_format = CASE WHEN source IN ('gpx', 'fit', 'tcx') THEN source ELSE file_format END,
          external_id = CASE WHEN source = 'strava' AND imported = 1 THEN id::text ELSE external_id END
      WHERE imported = 1
    `);
  }
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS activities_user_content_hash ON activities (user_id, content_hash) WHERE content_hash IS NOT NULL",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS activity_file_ids (
      user_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      activity_id BIGINT NOT NULL,
      PRIMARY KEY (user_id, content_hash)
    )
  `);
  await client.query(`
    INSERT INTO activity_file_ids (user_id, content_hash, activity_id)
    SELECT user_id, content_hash, id FROM activities
    WHERE content_hash IS NOT NULL
    ON CONFLICT (user_id, content_hash) DO NOTHING
  `);
}

async function ensureActivitiesTenancy(client: SqlClient) {
  await ensureColumn(client, "activities", "user_id", "TEXT");
  await client.query("UPDATE activities SET user_id = $1 WHERE user_id IS NULL", [PENDING_USER_ID]);
  await client.query("ALTER TABLE activities ALTER COLUMN user_id SET NOT NULL");

  const pkCols = await query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'activities'
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [],
    client,
  );
  const names = pkCols.map((row) => row.column_name);
  if (!(names.includes("user_id") && names.includes("id") && names.length === 2)) {
    const constraint = await queryOne<{ constraint_name: string }>(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND table_name = 'activities' AND constraint_type = 'PRIMARY KEY'`,
      [],
      client,
    );
    if (constraint?.constraint_name) {
      await client.query(`ALTER TABLE activities DROP CONSTRAINT ${constraint.constraint_name}`);
    }
    await client.query("ALTER TABLE activities ADD PRIMARY KEY (user_id, id)");
  }

  await client.query("DROP INDEX IF EXISTS activities_start_date");
  await client.query("CREATE INDEX IF NOT EXISTS activities_user_start_date ON activities (user_id, start_date)");
}

async function ensureColumn(
  client: SqlClient,
  table: string,
  column: string,
  ddl: string,
): Promise<boolean> {
  const existing = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
    client,
  );
  if (existing?.exists) return false;
  await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

async function maybeImportSqlite(client: SqlClient) {
  if (!fs.existsSync(DB_PATH)) return;
  const [activities, settings] = await Promise.all([
    queryOne<{ n: number }>("SELECT COUNT(*)::int AS n FROM activities", [], client),
    queryOne<{ n: number }>("SELECT COUNT(*)::int AS n FROM settings", [], client),
  ]);
  if ((activities?.n ?? 0) > 0 || (settings?.n ?? 0) > 0) return;

  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    console.warn(`Found ${DB_PATH} but node:sqlite is unavailable; starting with an empty Postgres database`);
    return;
  }

  const sqlite = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const settingRows = sqlite.prepare("SELECT key, value FROM settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const activityRows = sqlite.prepare("SELECT * FROM activities").all() as Array<Record<string, unknown>>;
    for (const row of settingRows) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [row.key, row.value],
      );
    }
    for (const row of activityRows) {
      await client.query(
        `INSERT INTO activities (
           user_id, id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
           total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced,
           latlng, "time", velocity, altitude, bbox, segment_efforts, source, imported
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
           $16, $17, $18, $19, $20, $21, $22, $23
         ) ON CONFLICT (user_id, id) DO NOTHING`,
        [
          PENDING_USER_ID,
          row.id,
          row.name,
          row.type,
          row.sport_type,
          row.start_date,
          row.distance,
          row.moving_time,
          row.elapsed_time,
          row.total_elevation_gain,
          row.average_speed,
          row.max_speed,
          row.trainer ?? 0,
          row.has_gps ?? 0,
          row.streams_synced ?? 0,
          row.latlng,
          row.time,
          row.velocity,
          row.altitude,
          row.bbox,
          row.segment_efforts ?? null,
          row.source ?? "strava",
          row.imported ?? 0,
        ],
      );
    }
    console.log(`imported ${activityRows.length} activities and ${settingRows.length} settings from ${DB_PATH}`);
  } finally {
    sqlite.close();
  }
}

export async function getSetting(key: string, client?: SqlClient): Promise<string | null> {
  const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key], client);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, client?: SqlClient) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
    client,
  );
}

export async function getJsonSetting<T>(key: string, client?: SqlClient): Promise<T | null> {
  const raw = await getSetting(key, client);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function setJsonSetting(key: string, value: unknown, client?: SqlClient) {
  await setSetting(key, JSON.stringify(value), client);
}

export async function deleteSetting(key: string, client?: SqlClient) {
  await query("DELETE FROM settings WHERE key = $1", [key], client);
}

export async function closeDb() {
  const current = pool;
  pool = null;
  ready = null;
  if (current) await current.end();
}
