import fs from "node:fs";
import path from "node:path";
import { type AuthUser } from "./auth";
import { withTransaction, type SqlClient } from "./db";
import { beginAccountDeletion } from "./durableJobs";
import { removeUserGenerationJobs } from "./generationJobs";
import { DATA_DIR, LLM_TRACES_DIR, OSM_CACHE_DIR } from "./paths";
import { assertSafeUserId, createLocalStore, createR2Store, posterStore, r2Config } from "./storage";

export function validateAccountDeletion(origin: string | undefined, allowedOrigins: string[], confirmation: unknown, email: string) {
  if (!origin || !allowedOrigins.includes(origin)) return "Account deletion requires a trusted origin.";
  if (confirmation !== email) return "Enter your account email to confirm deletion.";
  return null;
}

export async function deleteAccountRows(client: SqlClient, user: AuthUser) {
  await client.query("DELETE FROM activities WHERE user_id = $1", [user.id]);
  await client.query("DELETE FROM activity_file_ids WHERE user_id = $1", [user.id]);
  await client.query("DELETE FROM settings WHERE key = ANY($1::text[])", [[
    `poster_index_v1:${user.id}`, `imported_id_next:${user.id}`, `poster_activity_rebind_v1:${user.id}`,
  ]]);
  // Retain the bootstrap marker, without the deleted user's identity, so legacy data cannot be reclaimed.
  await client.query("UPDATE settings SET value = 'deleted' WHERE key = 'bootstrap_claimed' AND value = $1", [user.id]);
  await client.query("DELETE FROM verification WHERE value = $1 OR identifier = $2", [user.id, user.email]);
  // Sessions, provider credentials, and generation usage cascade from the user row.
  await client.query('DELETE FROM "user" WHERE id = $1', [user.id]);
}

const services = {
  async removeFiles(userId: string) {
    assertSafeUserId(userId);
    await posterStore().removeUser(userId);
    // Also purge old local posters after a move to R2.
    await createLocalStore().removeUser(userId);
    await createLocalStore(path.join(DATA_DIR,"references")).removeUser(userId);
    const remote = r2Config();
    if (remote) { await createR2Store(remote, "references/").removeUser(userId); await createR2Store(remote, "traces/").removeUser(userId); }
    fs.rmSync(path.join(LLM_TRACES_DIR, userId), { recursive: true, force: true });
    fs.rmSync(path.join(OSM_CACHE_DIR, "scenes", userId), { recursive: true, force: true });
    // Older diagnostics/scenes were not attributed to accounts. Discard those caches
    // as well: they can contain this user's prompts and cropped route coordinates.
    for (const root of [LLM_TRACES_DIR, path.join(OSM_CACHE_DIR, "scenes")]) {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile()) fs.unlinkSync(path.join(root, entry.name));
      }
    }
  },
  removeJobs: removeUserGenerationJobs,
  transaction: withTransaction,
};

/** Caller holds exclusive account access. On storage failure retain the account for retry. */
export async function purgeAccount(user: AuthUser, dependencies: { removeFiles: typeof services.removeFiles; removeJobs: (userId: string) => void | Promise<void>; transaction: typeof services.transaction } = services) {
  await beginAccountDeletion(user.id);
  await dependencies.removeFiles(user.id);
  await dependencies.removeJobs(user.id);
  await dependencies.transaction(client => deleteAccountRows(client, user));
}
