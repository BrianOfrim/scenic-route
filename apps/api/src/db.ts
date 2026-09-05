import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "./paths";

let sqlite: Database.Database | null = null;

function migrate(connection: Database.Database) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      sport_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      distance REAL NOT NULL,
      moving_time INTEGER,
      elapsed_time INTEGER,
      total_elevation_gain REAL,
      average_speed REAL,
      max_speed REAL,
      trainer INTEGER NOT NULL DEFAULT 0,
      has_gps INTEGER NOT NULL DEFAULT 0,
      streams_synced INTEGER NOT NULL DEFAULT 0,
      latlng TEXT,
      time TEXT,
      velocity TEXT,
      altitude TEXT,
      bbox TEXT
    );

    CREATE INDEX IF NOT EXISTS activities_streams_synced ON activities (streams_synced);
    CREATE INDEX IF NOT EXISTS activities_start_date ON activities (start_date);
  `);
}

export function getDb() {
  if (!sqlite) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");
    migrate(sqlite);
  }
  return sqlite;
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getJsonSetting<T>(key: string): T | null {
  const raw = getSetting(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export function setJsonSetting(key: string, value: unknown) {
  setSetting(key, JSON.stringify(value));
}
