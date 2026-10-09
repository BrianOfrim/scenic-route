import path from "node:path";
import { config } from "dotenv";
import { closeDb, query } from "../apps/api/src/db";
import { REPO_ROOT } from "../apps/api/src/paths";
import { parseImageLimits } from "../apps/api/src/imageLimits";

config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
const [email, active, unfinished, selections, ...extra] = process.argv.slice(2);
try {
  if (!email?.trim() || !active || !unfinished || !selections || extra.length) throw new Error("Usage: npm run image:limits -- user@example.com <active> <unfinished> <selections> (each: positive integer, unlimited, or default)");
  const overrides: Record<string, number | null> = {};
  for (const [key, value] of Object.entries({ active, unfinished, selections })) {
    if (value === "default") continue;
    if (value !== "unlimited" && !/^\d+$/.test(value)) throw new Error(`Invalid ${key} limit`);
    overrides[key] = value === "unlimited" ? null : Number(value);
  }
  const effective = parseImageLimits(overrides);
  const users = await query<{ email: string }>('UPDATE "user" SET image_limits = $2::jsonb WHERE lower(email) = lower($1) RETURNING email', [email.trim(), JSON.stringify(overrides)]);
  if (!users.length) throw new Error("No account found for that email.");
  console.log(`${users[0].email}: ${JSON.stringify(effective)} (null = unlimited; global service limits still apply)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not update image limits.");
  process.exitCode = 1;
} finally { await closeDb(); }
