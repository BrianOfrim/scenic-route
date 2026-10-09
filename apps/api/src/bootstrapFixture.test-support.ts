import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { after, before } from "node:test";
import pg from "pg";
import { closeAccountLocks } from "./accountLifecycle";
import { closeDb, databaseUrl, getPool } from "./db";
import { createLocalStore, resetPosterStore } from "./storage";

/** Own the database and storage: bootstrap examines global legacy state. */
export function useBootstrapFixture() {
  const base = new URL(databaseUrl());
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
    throw new Error("Bootstrap fixtures require a local PostgreSQL server.");
  }
  const name = `bootstrap_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: base.href });
  const previousUrl = process.env.DATABASE_URL;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenic-bootstrap-"));
  const store = createLocalStore(root);
  let created = false;
  before(async () => {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    base.pathname = `/${name}`;
    process.env.DATABASE_URL = base.href;
    const fixture = new pg.Pool({ connectionString: base.href });
    try {
      // Model an already migrated installation. A nonempty settings table also
      // prevents getPool from importing the checkout's real legacy SQLite file.
      await fixture.query(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO settings VALUES ('bootstrap_claimed', 'test-fixture');`);
    } finally { await fixture.end(); }
    resetPosterStore(store);
    await getPool();
  });
  after(async () => {
    try {
      await closeAccountLocks();
      await closeDb();
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      resetPosterStore();
      fs.rmSync(root, { recursive: true, force: true });
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });
  return { root, store };
}
