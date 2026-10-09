import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { databaseUrl, type SqlClient } from "./db";

export const accountContext = new AsyncLocalStorage<string>();
export class AccountUnavailableError extends Error {
  constructor(message: string, public status: 401 | 403 | 409) { super(message); }
}

// Keep lock leases separate from application queries, which may need their own
// transactions while the lease is held. Sharing a pool can deadlock under load.
let locks: pg.Pool | undefined;
export async function closeAccountLocks() {
  const current = locks;
  locks = undefined;
  await current?.end();
}

/** Shared by HTTP requests and workers; exclusive deletion also works across API processes. */
export async function withAccountAccess<T>(userId: string, exclusive: boolean, work: (client: SqlClient) => Promise<T>, allowWaiting = false) {
  const client = await (locks ??= new pg.Pool({ connectionString: databaseUrl(), max: 100 })).connect();
  const mode = exclusive ? "" : "_shared";
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock${mode}(hashtextextended($1, 0)) AS locked`, [`account:${userId}`],
    );
    locked = result.rows[0].locked;
    if (!locked) throw new AccountUnavailableError("Your account has requests in progress. Please wait for them to finish and try again.", 409);
    const user = await client.query('SELECT id, beta_status FROM "user" WHERE id = $1', [userId]);
    if (!user.rowCount) throw new AccountUnavailableError("sign in required", 401);
    if (!allowWaiting && user.rows[0].beta_status !== "admitted") {
      throw new AccountUnavailableError("Your account is on the public beta waitlist.", 403);
    }
    return await accountContext.run(userId, () => work(client));
  } finally {
    try {
      if (locked) await client.query(`SELECT pg_advisory_unlock${mode}(hashtextextended($1, 0))`, [`account:${userId}`]);
    } finally { client.release(); }
  }
}
