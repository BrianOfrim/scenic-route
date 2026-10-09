import { getImageLimits, parseImageLimits } from "./imageLimits";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { deleteAccountRows, purgeAccount, validateAccountDeletion } from "./accountDeletion";
import { AccountUnavailableError, closeAccountLocks, withAccountAccess } from "./accountLifecycle";
import { closeDb, initDb, query, withTransaction } from "./db";
import { createLocalStore } from "./storage";

const ids: string[] = [];
before(() => initDb());
after(async () => {
  await query('DELETE FROM activities WHERE user_id = ANY($1::text[])', [ids]);
  await query('DELETE FROM activity_file_ids WHERE user_id = ANY($1::text[])', [ids]);
  await query('DELETE FROM "user" WHERE id = ANY($1::text[])', [ids]);
  await query('DELETE FROM verification WHERE value = ANY($1::text[])', [ids]);
  await query('DELETE FROM settings WHERE key = ANY($1::text[])', [ids.flatMap(id => [`imported_id_next:${id}`, `poster_activity_rebind_v1:${id}`])]);
  await closeAccountLocks();
  await closeDb();
});
async function fixture() {
  const id = `deletion-test-${randomUUID()}`;
  const user = { id, email: `${id}@example.com` };
  ids.push(id);
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [id, user.email]);
  await query(`INSERT INTO activities (user_id, id, name, type, sport_type, start_date, distance) VALUES ($1, 1, 'Ride', 'Ride', 'Ride', '2026-10-01', 1)`, [id]);
  await query('INSERT INTO activity_file_ids (user_id, content_hash, activity_id) VALUES ($1, $1, 1)', [id]);
  await query(`INSERT INTO session (id, "expiresAt", token, "userId") VALUES ($1, now() + interval '1 day', $1, $1)`, [id]);
  await query(`INSERT INTO account (id, "accountId", "providerId", "userId", password, "accessToken") VALUES ($1, $1, 'credential', $1, 'hash', 'secret')`, [id]);
  await query(`INSERT INTO verification (id, identifier, value, "expiresAt") VALUES ($1, $1, $1, now() + interval '1 day')`, [id]);
  await query(`INSERT INTO poster_generation_usage (id, user_id, month, reserved, expires_at) VALUES ($1, $1, '2026-10-01', 1, now())`, [id]);
  for (const prefix of ['imported_id_next:', 'poster_activity_rebind_v1:']) {
    await query('INSERT INTO settings (key, value) VALUES ($1, $2)', [prefix + id, '1']);
  }
  return user;
}

test("deletion requires the account email and trusted origin", () => {
  const origins = ['https://scenic.example'];
  assert.equal(validateAccountDeletion(origins[0], origins, 'a@example.com', 'a@example.com'), null);
  assert.ok(validateAccountDeletion(undefined, origins, 'a@example.com', 'a@example.com'));
  assert.ok(validateAccountDeletion('https://evil.example', origins, 'a@example.com', 'a@example.com'));
  assert.ok(validateAccountDeletion(origins[0], origins, 'b@example.com', 'a@example.com'));
});

test("purges every account table and all nested files while preserving another account", async () => {
  const user = await fixture();
  const other = await fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scenic-deletion-'));
  const store = createLocalStore(root);
  fs.mkdirSync(path.join(root, user.id, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, user.id, 'nested', 'orphan'), 'private');
  await store.put(other.id, 'keep.json', Buffer.from('{}'), 'application/json');
  try {
    await withAccountAccess(user.id, true, () => purgeAccount(user, {
      removeFiles: id => store.removeUser(id), removeJobs: () => {}, transaction: withTransaction,
    }));
    assert.equal(fs.existsSync(path.join(root, user.id)), false);
    assert.ok(await store.get(other.id, 'keep.json'));
    for (const [table, column] of [['activities', 'user_id'], ['activity_file_ids', 'user_id'], ['session', 'userId'], ['account', 'userId'], ['poster_generation_usage', 'user_id'], ['user', 'id'], ['verification', 'value']]) {
      assert.equal((await query(`SELECT * FROM "${table}" WHERE "${column}" = $1`, [user.id])).length, 0, table);
      assert.equal((await query(`SELECT * FROM "${table}" WHERE "${column}" = $1`, [other.id])).length, 1, `${table} other account`);
    }
    assert.equal((await query('SELECT * FROM settings WHERE key = ANY($1::text[])', [[`imported_id_next:${user.id}`, `poster_activity_rebind_v1:${user.id}`]])).length, 0);
    await assert.rejects(withAccountAccess(user.id, false, async () => {}), error => error instanceof AccountUnavailableError && error.status === 401);
    // Cleanup is idempotent for retries after a lost success response.
    await withTransaction(client => deleteAccountRows(client, user));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("storage failure keeps the account available for retry", async () => {
  const user = await fixture();
  await assert.rejects(purgeAccount(user, {
    removeFiles: async () => { throw new Error('storage unavailable'); },
    removeJobs: () => assert.fail('jobs must not be removed yet'),
    transaction: async () => assert.fail('database must not be deleted yet'),
  }), /storage unavailable/);
  assert.equal((await query('SELECT * FROM "user" WHERE id = $1', [user.id])).length, 1);
});

test("deletion excludes requests and active worker writes in both directions", async () => {
  const user = await fixture();
  await withAccountAccess(user.id, false, async () => {
    await assert.rejects(withAccountAccess(user.id, true, async () => assert.fail()), error => error instanceof AccountUnavailableError && error.status === 409);
  });
  await withAccountAccess(user.id, true, async () => {
    await assert.rejects(withAccountAccess(user.id, false, async () => assert.fail()), error => error instanceof AccountUnavailableError && error.status === 409);
  });
});


test("account-lock connection acquisition times out against an unresponsive database", { timeout: 20_000 }, async t => {
  await closeAccountLocks();
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // Accept TCP but never complete the Postgres handshake.
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const RealPool = pg.Pool;
  const replacement = t.mock.method(pg, "Pool", class extends RealPool {
    constructor(options?: pg.PoolConfig) {
      super({ ...options, connectionString: `postgres://test:test@127.0.0.1:${port}/test` });
    }
  });
  try {
    await assert.rejects(withAccountAccess("owner", false, async () => {
      assert.fail("work must not start without an account lock");
    }), /timeout/i);
  } finally {
    await closeAccountLocks();
    replacement.mock.restore();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("account image overrides persist independently and can restore defaults", async () => {
  const owner = await fixture();
  const other = await fixture();
  await query('UPDATE "user" SET image_limits = $2::jsonb WHERE id = $1', [owner.id, JSON.stringify({active: 32, unfinished: 64, selections: null})]);
  assert.deepEqual(await getImageLimits(owner.id), {active: 32, unfinished: 64, selections: null});
  assert.deepEqual(await getImageLimits(other.id), parseImageLimits());
  await query('UPDATE "user" SET image_limits = $2::jsonb WHERE id = $1', [owner.id, '{}']);
  assert.deepEqual(await getImageLimits(owner.id), parseImageLimits());
  for (const value of [0, -1, 1.5, "32"]) assert.throws(() => parseImageLimits({active: value}), /Invalid/);
});
