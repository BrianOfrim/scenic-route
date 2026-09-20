import assert from "node:assert/strict";
import { test } from "node:test";
import type { SyncProgress } from "./api";
import { PAGE_LOAD_SYNC, shouldContinueStravaSync } from "./stravaSync";

const pending: SyncProgress = {
  listComplete: true,
  listed: 2,
  streamsSynced: 1,
  streamsPending: 1,
  skipped: 0,
  done: false,
};

test("page-load sync runs one quiet batch", () => {
  assert.deepEqual(PAGE_LOAD_SYNC, { drain: false, reportErrors: false });
  assert.equal(shouldContinueStravaSync(pending, PAGE_LOAD_SYNC.drain), false);
});

test("manual sync continues until complete or rate limited", () => {
  assert.equal(shouldContinueStravaSync(pending, true), true);
  assert.equal(shouldContinueStravaSync({ ...pending, done: true }, true), false);
  assert.equal(shouldContinueStravaSync({ ...pending, rateLimited: true }, true), false);
});
