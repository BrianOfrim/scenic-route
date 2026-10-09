import path from "node:path";
import { config } from "dotenv";
import { closeDb, queryOne } from "../apps/api/src/db";
import { admitBetaUser } from "../apps/api/src/betaAdmission";
import { REPO_ROOT } from "../apps/api/src/paths";

config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });
const [email, flag, ...extra] = process.argv.slice(2);
if (!email || extra.length || (flag && flag !== "--exempt-operator")) {
  console.error("Usage: npm run beta:admit -- email [--exempt-operator]");
  process.exitCode = 1;
} else {
  try {
    if (flag) {
      const id = process.env.BETA_OPERATOR_USER_ID?.trim();
      if (!id) throw new Error("Set BETA_OPERATOR_USER_ID to the operator's exact account ID first.");
      const row = await queryOne(
        `UPDATE "user" SET beta_exempt = true, beta_status = 'admitted'
         WHERE id = $1 AND lower(email) = lower($2) RETURNING id`, [id, email.trim()],
      );
      if (!row) throw new Error("Email does not match the configured operator ID.");
    } else await admitBetaUser(email);
    console.log("Account admitted. No invitation email was sent.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Admission failed.");
    process.exitCode = 1;
  } finally { await closeDb(); }
}
