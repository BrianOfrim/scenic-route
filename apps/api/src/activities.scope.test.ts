import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));

function source(name: string) {
  return readFileSync(path.join(root, name), "utf8");
}

test("activity queries include user_id", () => {
  const activities = source("activities.ts");
  assert.match(activities, /FROM activities\s+WHERE user_id = \$1/s);
  assert.match(activities, /WHERE user_id = \$1 AND id = \$2/);
  assert.match(activities, /DELETE FROM activities WHERE user_id = \$1 AND id = \$2/);

  const sync = source("sync.ts");
  assert.match(sync, /ON CONFLICT \(user_id, id\)/);
  assert.match(sync, /FROM activities\s+WHERE user_id = \$1/s);
  assert.match(sync, /WHERE user_id = \$1 AND streams_synced = 0/);
});
