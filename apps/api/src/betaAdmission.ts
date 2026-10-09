import { queryOne } from "./db";

export type BetaStatus = "admitted" | "waiting";
export async function getBetaStatus(userId: string): Promise<BetaStatus> {
  const row = await queryOne<{ beta_status: BetaStatus }>(
    'SELECT beta_status FROM "user" WHERE id = $1', [userId],
  );
  // Missing users must never gain access through a stale session.
  return row?.beta_status ?? "waiting";
}

/** Local operator only: requires database credentials; never exposed over HTTP.
 * The database trigger rejects admissions above the cap, including CLI races. */
export async function admitBetaUser(email: string) {
  const row = await queryOne<{ id: string }>(
    `UPDATE "user" SET beta_status = 'admitted'
     WHERE lower(email) = lower($1) RETURNING id`, [email.trim()],
  );
  if (!row) throw new Error("No account found.");
}
