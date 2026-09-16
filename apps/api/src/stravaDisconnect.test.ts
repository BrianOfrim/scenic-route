import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));

function source(name: string) {
  return readFileSync(path.join(root, name), "utf8");
}

test("disconnectStrava unlinks and clears synced Strava activities atomically", () => {
  const strava = source("strava.ts");

  // The whole unlink runs in a single transaction.
  assert.match(strava, /export async function disconnectStrava[\s\S]*?withTransaction/);

  // Synced Strava activities are removed, scoped to the user.
  assert.match(strava, /DELETE FROM activities\s+WHERE user_id = \$1/);

  // Manually uploaded activities (GPX/FIT/TCX) are preserved.
  assert.match(strava, /COALESCE\(imported, 0\) = 0/);
  assert.match(strava, /source IS NULL OR source = 'strava'/);
  assert.match(strava, /id < 2000000000000/);

  // The stored connection (tokens, athlete, sync state) is removed too.
  assert.match(strava, /DELETE FROM strava_connections WHERE user_id = \$1/);
});

test("disconnect endpoint reports how many synced activities were removed", () => {
  const index = source("index.ts");
  assert.match(index, /disconnectStrava\(currentUserId\(c\)\)/);
  assert.match(index, /removedActivities/);
});
