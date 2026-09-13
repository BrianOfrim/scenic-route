import fs from "node:fs";
import pg from "pg";
import { DB_PATH } from "./paths";

const { Pool, types } = pg;

types.setTypeParser(types.builtins.INT8, (value) => Number(value));
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

export type SqlClient = Pick<pg.Pool | pg.PoolClient, "query">;

const DEFAULT_DATABASE_URL = "postgres://scenic:scenic@127.0.0.1:5432/scenic_route";

let pool: pg.Pool | null = null;
let ready: Promise<pg.Pool> | null = null;

export function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
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
        await migrate(created);
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
      segment_efforts TEXT,
      source TEXT NOT NULL DEFAULT 'strava',
      imported INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS activities_streams_synced ON activities (streams_synced);
    CREATE INDEX IF NOT EXISTS activities_start_date ON activities (start_date);
  `);

  await ensureColumn(client, "activities", "segment_efforts", "TEXT");
  await ensureColumn(client, "activities", "source", "TEXT NOT NULL DEFAULT 'strava'");
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
           id, name, "type", sport_type, start_date, distance, moving_time, elapsed_time,
           total_elevation_gain, average_speed, max_speed, trainer, has_gps, streams_synced,
           latlng, "time", velocity, altitude, bbox, segment_efforts, source, imported
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22
         ) ON CONFLICT (id) DO NOTHING`,
        [
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

export async function closeDb() {
  const current = pool;
  pool = null;
  ready = null;
  if (current) await current.end();
}
