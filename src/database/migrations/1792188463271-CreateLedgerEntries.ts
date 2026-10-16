import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The driver ledger (D58). Generated from `LedgerEntry`, then edited by hand: the two triggers at the end of `up`
 * (and their removal at the start of `down`) are not something TypeORM generates.
 *
 * - `ledger_entries_append_only`: refuses every UPDATE and DELETE, so the ledger stays append-only even if the
 *   code had a bug or someone ran SQL by hand (D6). TRUNCATE is not covered (tests reset the table with it).
 * - `ledger_entries_check_reversal`: a reversal must cancel exactly its original: same driver, same amount,
 *   opposite direction, and the original must not be a reversal itself. A CHECK cannot look at another row; a
 *   trigger can.
 */

export class CreateLedgerEntries1792188463271 implements MigrationInterface {
  name = "CreateLedgerEntries1792188463271";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_entry_kind" AS ENUM('rent', 'payment', 'adjustment', 'reversal')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_category" AS ENUM('late_fee', 'repair', 'damage', 'toll', 'ticket', 'cleaning', 'other_charge', 'discount', 'goodwill', 'other_credit', 'opening_balance')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "direction" "public"."ledger_direction" NOT NULL, "amount_cents" integer NOT NULL, "kind" "public"."ledger_entry_kind" NOT NULL, "category" "public"."ledger_category", "description" character varying(500) NOT NULL, "effective_date" date NOT NULL, "payment_id" uuid, "reversal_of_id" uuid, "created_by_id" uuid, "idempotency_key" character varying(200) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8d7d965da3a677d839ae524032f" UNIQUE ("reversal_of_id"), CONSTRAINT "UQ_87365c6d1bdfe31d9aca7a2d1c0" UNIQUE ("idempotency_key"), CONSTRAINT "ledger_entries_category_direction" CHECK ("category" IS NULL OR "category" = 'opening_balance' OR ("category" IN ('late_fee', 'repair', 'damage', 'toll', 'ticket', 'cleaning', 'other_charge') AND "direction" = 'debit') OR ("category" IN ('discount', 'goodwill', 'other_credit') AND "direction" = 'credit')), CONSTRAINT "ledger_entries_adjustment_shape" CHECK (("kind" = 'adjustment') = ("category" IS NOT NULL) AND ("kind" <> 'adjustment' OR "created_by_id" IS NOT NULL)), CONSTRAINT "ledger_entries_reversal_shape" CHECK (("kind" = 'reversal') = ("reversal_of_id" IS NOT NULL) AND ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id")), CONSTRAINT "ledger_entries_payment_shape" CHECK (("kind" <> 'payment' OR ("payment_id" IS NOT NULL AND "direction" = 'credit')) AND ("payment_id" IS NULL OR "kind" IN ('payment', 'reversal'))), CONSTRAINT "ledger_entries_description_length" CHECK (length(btrim("description")) BETWEEN 1 AND 500), CONSTRAINT "ledger_entries_amount_range" CHECK ("amount_cents" > 0 AND "amount_cents" <= 100000000), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ledger_entries_one_opening_balance_key" ON "ledger_entries"  ("driver_id") WHERE "category" = 'opening_balance'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ledger_entries_payment_idx" ON "ledger_entries"  ("payment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ledger_entries_driver_date_idx" ON "ledger_entries"  ("driver_id", "effective_date", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_44b2fbfd32a655c75e985ec8cd9" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_8b7251f063c8800a0fc0821cba5" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_8d7d965da3a677d839ae524032f" FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_fda2c465f56e2496f69c76d7111" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE FUNCTION "ledger_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger_entries is append-only: % refused (use a reversal entry)', TG_OP USING ERRCODE = 'restrict_violation'; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION "ledger_entries_append_only"()`,
    );
    await queryRunner.query(
      `CREATE FUNCTION "ledger_entries_check_reversal"() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE original "ledger_entries"%ROWTYPE; BEGIN IF NEW."reversal_of_id" IS NULL THEN RETURN NEW; END IF; SELECT * INTO original FROM "ledger_entries" WHERE "id" = NEW."reversal_of_id"; IF original."kind" = 'reversal' OR original."driver_id" <> NEW."driver_id" OR original."amount_cents" <> NEW."amount_cents" OR original."direction" = NEW."direction" THEN RAISE EXCEPTION 'ledger reversal does not match entry %', NEW."reversal_of_id" USING ERRCODE = 'check_violation'; END IF; RETURN NEW; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "ledger_entries_check_reversal" BEFORE INSERT ON "ledger_entries" FOR EACH ROW EXECUTE FUNCTION "ledger_entries_check_reversal"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "ledger_entries_check_reversal" ON "ledger_entries"`,
    );
    await queryRunner.query(`DROP FUNCTION "ledger_entries_check_reversal"()`);
    await queryRunner.query(
      `DROP TRIGGER "ledger_entries_append_only" ON "ledger_entries"`,
    );
    await queryRunner.query(`DROP FUNCTION "ledger_entries_append_only"()`);
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_fda2c465f56e2496f69c76d7111"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_8d7d965da3a677d839ae524032f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_8b7251f063c8800a0fc0821cba5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_44b2fbfd32a655c75e985ec8cd9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ledger_entries_driver_date_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ledger_entries_payment_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."ledger_entries_one_opening_balance_key"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_category"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_entry_kind"`);
    await queryRunner.query(`DROP TYPE "public"."ledger_direction"`);
  }
}
