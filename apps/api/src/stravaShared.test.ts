import assert from "node:assert/strict";
import { test } from "node:test";
import { closeDb, initDb, query } from "./db";

test("different users can store the same Strava athlete_id", async () => {
  await initDb();
  const suffix = `${Date.now()}`;
  const userA = `shared-strava-a-${suffix}`;
  const userB = `shared-strava-b-${suffix}`;
  const athleteId = 9_000_000 + (Date.now() % 100_000);
  try {
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'A', $2, true), ($3, 'B', $4, true)`,
      [userA, `${userA}@example.com`, userB, `${userB}@example.com`],
    );
    await query(
      `INSERT INTO strava_connections
         (user_id, access_token, refresh_token, expires_at, athlete_id)
       VALUES
         ($1, 'tok-a', 'ref-a', 2000000000, $3),
         ($2, 'tok-b', 'ref-b', 2000000000, $3)`,
      [userA, userB, athleteId],
    );
    const rows = await query<{ user_id: string; athlete_id: string }>(
      `SELECT user_id, athlete_id::text AS athlete_id
       FROM strava_connections
       WHERE athlete_id = $1
       ORDER BY user_id`,
      [athleteId],
    );
    assert.deepEqual(
      rows.map((row) => row.user_id).sort(),
      [userA, userB].sort(),
    );
    assert.equal(rows.length, 2);
  } finally {
    await query("DELETE FROM strava_connections WHERE user_id = ANY($1::text[])", [
      [userA, userB],
    ]);
    await query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[userA, userB]]);
    await closeDb();
  }
});
