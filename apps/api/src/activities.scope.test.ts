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
  assert.match(activities, /WHERE user_id = \$1 AND id = \$2 AND imported = 1/);
  assert.match(activities, /DELETE FROM activities WHERE user_id = \$1 AND id = \$2/);

  const importer = source("importActivity.ts");
  assert.match(importer, /WHERE user_id = \$1 AND content_hash = \$2 AND imported = 1/);
  assert.match(importer, /WHERE user_id = \$1 AND id = \$2/);
});
