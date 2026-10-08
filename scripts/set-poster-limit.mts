import path from "node:path";
import { config } from "dotenv";
import { closeDb, query } from "../apps/api/src/db";
import { REPO_ROOT } from "../apps/api/src/paths";

config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

const [email, value, ...extra] = process.argv.slice(2);
const limit = value === "unlimited" ? null : Number(value);
if (!email || !value || extra.length || (limit !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit > 2_147_483_647))) {
  console.error("Usage: npm run poster:limit -- user@example.com <unlimited|50>");
  process.exitCode = 1;
} else {
  try {
    const users = await query<{ email: string }>(
      'UPDATE "user" SET poster_monthly_limit = $2 WHERE lower(email) = lower($1) RETURNING email',
      [email.trim(), limit],
    );
    if (!users.length) throw new Error("No account found for that email.");
    console.log(`${users[0].email}: ${limit === null ? "unlimited posters" : `${limit} posters per month`}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not update poster limit.");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
