import assert from "node:assert/strict";
import { test } from "node:test";
import { signStravaState, verifyStravaState } from "./strava";

test("HMAC Strava state round-trips the user id", () => {
  const now = 1_700_000_000_000;
  const state = signStravaState("user-123", now);
  assert.equal(verifyStravaState(state, now), "user-123");
});

test("HMAC Strava state rejects tampering and expiry", () => {
  const now = 1_700_000_000_000;
  const state = signStravaState("user-123", now);
  const flipped = `${state.slice(0, -2)}aa`;
  assert.throws(() => verifyStravaState(flipped, now), /invalid Strava state/);
  assert.throws(() => verifyStravaState(state, now + 31 * 60 * 1000), /expired/);
});
