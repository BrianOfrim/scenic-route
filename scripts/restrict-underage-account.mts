import path from "node:path";
import { config } from "dotenv";
import { closeDb, queryOne, withTransaction } from "../apps/api/src/db";
import { closeAccountLocks, withAccountAccess } from "../apps/api/src/accountLifecycle";
import { REPO_ROOT } from "../apps/api/src/paths";
config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
const [email, ...extra] = process.argv.slice(2);
try {
  if (!email || extra.length) throw new Error("Usage: npx tsx scripts/restrict-underage-account.mts user@example.com");
  const user = await queryOne<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1)', [email.trim()]);
  if (!user) throw new Error("Account not found");
  // Refuse while requests are active. Retry after work drains; do not race an upstream call.
  await withAccountAccess(user.id, true, async () => withTransaction(async client => {
    await client.query('UPDATE "user" SET eligibility_blocked = true WHERE id = $1', [user.id]);
    await client.query(`INSERT INTO participation_events (user_id, kind, version, accepted) VALUES ($1, 'eligibility', 'operator-known-underage-v1', false)`, [user.id]);
  }));
  console.log("Account restricted. Protected use and queued generation are blocked; deletion and privacy requests remain available.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Restriction failed"); process.exitCode = 1;
} finally { await closeDb(); await closeAccountLocks(); }
