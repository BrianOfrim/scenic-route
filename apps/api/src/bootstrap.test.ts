import assert from "node:assert/strict";
import { test } from "node:test";
import { canClaimBootstrap } from "./bootstrap";

test("bootstrap email matches the configured account, or the first user when unset", () => {
  const previous = process.env.BOOTSTRAP_EMAIL;
  delete process.env.BOOTSTRAP_EMAIL;
  assert.equal(canClaimBootstrap("anyone@example.com"), true);
  process.env.BOOTSTRAP_EMAIL = "Owner@example.com";
  assert.equal(canClaimBootstrap("owner@example.com"), true);
  assert.equal(canClaimBootstrap("other@example.com"), false);
  if (previous == null) delete process.env.BOOTSTRAP_EMAIL;
  else process.env.BOOTSTRAP_EMAIL = previous;
});
