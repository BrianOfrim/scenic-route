import { deleteSetting, query, queryOne, setSetting, withTransaction, type SqlClient } from "./db";

/** Imported tracks start here so they never collide with archive external ids. */
export const IMPORTED_ID_BASE = 2_000_000_000_000;

function settingKey(userId: string) {
  return `imported_id_next:${userId}`;
}

async function withImportedIdLock<T>(
  userId: string,
  client: SqlClient | undefined,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  if (client) return fn(client);
  return withTransaction(fn);
}

/** Lock this user's next-id row and return the stored floor. Missing rows start at the base. */
async function lockImportedIdFloor(userId: string, client: SqlClient): Promise<number> {
  const key = settingKey(userId);
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [key, String(IMPORTED_ID_BASE)],
    client,
  );
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1 FOR UPDATE`,
    [key],
    client,
  );
  const stored = Number(row?.value);
  return Number.isFinite(stored) ? stored : IMPORTED_ID_BASE;
}

/**
 * Next imported activity id. The floor only moves forward, including across deletes,
 * so a new import cannot inherit an id that older posters still reference.
 */
export async function allocateImportedId(userId: string, client?: SqlClient): Promise<number> {
  return withImportedIdLock(userId, client, async (tx) => {
    const stored = await lockImportedIdFloor(userId, tx);
    const maxRow = await queryOne<{ maxId: number | null }>(
      `SELECT MAX(id) AS "maxId" FROM activities WHERE user_id = $1 AND id >= $2`,
      [userId, IMPORTED_ID_BASE],
      tx,
    );
    const id = Math.max(stored, (maxRow?.maxId ?? IMPORTED_ID_BASE - 1) + 1);
    await setSetting(settingKey(userId), String(id + 1), tx);
    return id;
  });
}

/** Raise the floor past an id that has been used, without handing that id out again. */
export async function rememberImportedId(userId: string, id: number, client?: SqlClient) {
  if (!Number.isInteger(id) || id < IMPORTED_ID_BASE) return;
  await withImportedIdLock(userId, client, async (tx) => {
    const stored = await lockImportedIdFloor(userId, tx);
    const next = Math.max(stored, id + 1);
    if (next !== stored) await setSetting(settingKey(userId), String(next), tx);
  });
}

/** Record every imported id that already exists so the next allocation stays above them. */
export async function sealImportedIdFloors() {
  const rows = await query<{ user_id: string; maxId: number }>(
    `SELECT user_id, MAX(id) AS "maxId" FROM activities WHERE id >= $1 GROUP BY user_id`,
    [IMPORTED_ID_BASE],
  );
  for (const row of rows) {
    if (row.user_id) await rememberImportedId(row.user_id, row.maxId);
  }
}

export async function clearImportedIdFloor(userId: string) {
  await deleteSetting(settingKey(userId));
}
