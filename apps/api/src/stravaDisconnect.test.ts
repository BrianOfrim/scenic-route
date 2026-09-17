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

  // Revoke on Strava before clearing local tokens so reconnect is not silent.
  assert.match(strava, /STRAVA_REVOKE_URL = "https:\/\/www\.strava\.com\/oauth\/revoke"/);
  assert.match(
    strava,
    /export async function disconnectStrava[\s\S]*?revokeStravaAuthorization\(tokens\)[\s\S]*?withTransaction/,
  );

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

test("connect Strava always forces the authorization prompt", () => {
  const strava = source("strava.ts");
  assert.match(strava, /approval_prompt: "force"/);
  assert.doesNotMatch(strava, /approval_prompt: "auto"/);
});

test("connect Strava shows a logout interstitial before OAuth", () => {
  const strava = source("strava.ts");
  const index = source("index.ts");
  assert.match(strava, /stravaConnectInterstitialHtml/);
  assert.match(strava, /www\.strava\.com\/logout/);
  assert.match(index, /stravaConnectInterstitialHtml/);
  assert.match(index, /c\.req\.query\("go"\) === "1"/);
  assert.match(index, /\/api\/strava\/auth\?go=1/);
});

test("disconnect endpoint reports how many synced activities were removed", () => {
  const index = source("index.ts");
  assert.match(index, /disconnectStrava\(currentUserId\(c\)\)/);
  assert.match(index, /removedActivities/);
});
