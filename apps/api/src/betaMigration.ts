import type { SqlClient } from "./db";

/** A row counter, rather than a count query, serializes even concurrent inserts
 * inside auth transactions. Rollbacks refund reservations automatically. */
export async function migrateBetaAdmission(client: SqlClient) {
  try {
    await client.query(`
    BEGIN;
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS beta_status TEXT NOT NULL DEFAULT 'admitted'
      CHECK (beta_status IN ('admitted', 'waiting'));
    ALTER TABLE "user" ADD COLUMN IF NOT EXISTS beta_exempt BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS beta_capacity (
      singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
      used INTEGER NOT NULL CHECK (used >= 0)
    );
    INSERT INTO beta_capacity (used)
      SELECT count(*)::int FROM "user" WHERE beta_status = 'admitted' AND NOT beta_exempt
      ON CONFLICT DO NOTHING;

    CREATE OR REPLACE FUNCTION enforce_beta_capacity() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE old_counted boolean := false; new_counted boolean := false;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        old_counted := OLD.beta_status = 'admitted' AND NOT OLD.beta_exempt;
      END IF;
      IF TG_OP <> 'DELETE' THEN
        new_counted := NEW.beta_status = 'admitted' AND NOT NEW.beta_exempt;
      END IF;
      IF new_counted AND NOT old_counted THEN
        UPDATE beta_capacity SET used = used + 1 WHERE singleton AND used < 100;
        IF NOT FOUND THEN
          IF TG_OP = 'INSERT' THEN NEW.beta_status := 'waiting';
          ELSE RAISE EXCEPTION 'Public beta is full (100 accounts)' USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      ELSIF old_counted AND NOT new_counted THEN
        UPDATE beta_capacity SET used = used - 1 WHERE singleton;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS beta_capacity_guard ON "user";
    CREATE TRIGGER beta_capacity_guard BEFORE INSERT OR DELETE OR UPDATE OF beta_status, beta_exempt
      ON "user" FOR EACH ROW EXECUTE FUNCTION enforce_beta_capacity();
    COMMIT;
    `);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
