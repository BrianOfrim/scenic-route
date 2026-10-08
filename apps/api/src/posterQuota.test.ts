import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, initDb, query } from "./db";
import { getPosterQuota, posterQuotaMonth, PosterQuotaError, reservePosterQuota, withPosterQuota } from "./posterQuota";

const users: string[] = [];
before(() => initDb());
after(async () => {
  await query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users]);
  await closeDb();
});

async function user() {
  const id = `quota-test-${randomUUID()}`;
  users.push(id);
  await query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $2, true)', [id, `${id}@example.com`]);
  return id;
}

test("UTC calendar month boundaries include year rollover and leap February", () => {
  assert.deepEqual(posterQuotaMonth(new Date("2026-12-31T23:59:59Z")), { month: "2026-12-01", resetsAt: "2027-01-01T00:00:00.000Z" });
  assert.deepEqual(posterQuotaMonth(new Date("2024-02-29T23:59:59Z")), { month: "2024-02-01", resetsAt: "2024-03-01T00:00:00.000Z" });
  assert.equal(posterQuotaMonth(new Date("2026-10-31T18:00:00-07:00")).month, "2026-11-01");
});

test("default allowance admits exactly 50 images and blocks provider calls beyond it", async () => {
  const id = await user();
  assert.equal((await getPosterQuota(id)).limit, 50);
  await (await reservePosterQuota(id, 49)).settle(49);
  let calls = 0;
  const generate = async () => { calls++; return { images: ["image"] }; };
  await withPosterQuota(id, 1, generate);
  await assert.rejects(withPosterQuota(id, 1, generate), PosterQuotaError);
  assert.equal(calls, 1);
  assert.equal((await getPosterQuota(id)).used, 50);
});

test("multiple requested images need enough room for the entire request", async () => {
  const id = await user();
  await (await reservePosterQuota(id, 49)).settle(49);
  await assert.rejects(reservePosterQuota(id, 2), PosterQuotaError);
  assert.equal((await getPosterQuota(id)).remaining, 1);
});

test("concurrent requests cannot claim the same remaining slot", async () => {
  const id = await user();
  await (await reservePosterQuota(id, 49)).settle(49);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => reservePosterQuota(id, 1)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof PosterQuotaError);
  assert.equal((await getPosterQuota(id)).remaining, 0);
  assert.equal((await getPosterQuota(id)).reserved, 1);
  for (const result of results) if (result.status === "fulfilled") await result.value.settle(1);
});

test("failed requests and absent outputs refund capacity; partial results count actual images", async () => {
  const id = await user();
  await assert.rejects(withPosterQuota(id, 4, async () => { throw new Error("provider failure"); }), /provider failure/);
  await withPosterQuota(id, 4, async () => ({ images: [] }));
  assert.equal((await getPosterQuota(id)).remaining, 50);
  await withPosterQuota(id, 4, async () => ({ images: ["one", "two"] }));
  const quota = await getPosterQuota(id);
  assert.equal(quota.used, 2);
  assert.equal(quota.reserved, 0);
  assert.equal(quota.remaining, 48);
});

test("unexpected extra provider outputs are capped at the reserved count", async () => {
  const id = await user();
  const result = await withPosterQuota(id, 1, async () => ({ images: ["one", "two"] }));
  assert.deepEqual(result.images, ["one"]);
  assert.equal((await getPosterQuota(id)).used, 1);
});

test("unlimited overrides exceed 50, and revocation preserves usage", async () => {
  const id = await user();
  await query('UPDATE "user" SET poster_monthly_limit = NULL WHERE id = $1', [id]);
  await (await reservePosterQuota(id, 60)).settle(60);
  assert.equal((await getPosterQuota(id)).remaining, null);
  await query('UPDATE "user" SET poster_monthly_limit = 50 WHERE id = $1', [id]);
  await assert.rejects(reservePosterQuota(id, 1), PosterQuotaError);
  assert.equal((await getPosterQuota(id)).used, 60);
});

test("usage is isolated by account and month; stale pending reservations expire", async () => {
  const id = await user();
  const other = await user();
  await (await reservePosterQuota(other, 50)).settle(50);
  await query(`INSERT INTO poster_generation_usage (id, user_id, month, reserved, generated, expires_at)
    VALUES ($1, $2, ($3::date - interval '1 month')::date, 50, 50, now())`, [randomUUID(), id, posterQuotaMonth().month]);
  await query(`INSERT INTO poster_generation_usage (id, user_id, month, reserved, expires_at)
    VALUES ($1, $2, $3::date, 50, now() - interval '1 minute')`, [randomUUID(), id, posterQuotaMonth().month]);
  assert.equal((await getPosterQuota(id)).remaining, 50);
  await withPosterQuota(id, 1, async () => ({ images: ["new"] }));
  assert.equal((await getPosterQuota(id)).used, 1);
  assert.equal((await getPosterQuota(other)).used, 50);
});

test("settlement is idempotent and stays in the reservation's original month", async () => {
  const id = await user();
  const reservation = await reservePosterQuota(id, 3);
  await query(`UPDATE poster_generation_usage SET month = ($2::date - interval '1 month')::date WHERE user_id = $1`, [id, posterQuotaMonth().month]);
  await reservation.settle(2);
  await reservation.settle(0);
  const rows = await query<{ generated: number }>("SELECT generated FROM poster_generation_usage WHERE user_id = $1", [id]);
  assert.equal(rows[0].generated, 2);
  assert.equal((await getPosterQuota(id)).remaining, 50);
});
