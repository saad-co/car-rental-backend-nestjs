import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContractChargeKind1792640000000 implements MigrationInterface {
  name = "AddContractChargeKind1792640000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A new enum value cannot be used in the transaction that adds it, so nothing here writes or checks 'contract_charge'.
    await queryRunner.query(
      `ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'contract_charge'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The ledger is append-only (a trigger refuses DELETE), so entries of the new kind cannot be removed to go back.
    const [{ count }] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "ledger_entries" WHERE "kind" = 'contract_charge'`,
    )) as [{ count: number }];
    if (count > 0) {
      throw new Error(
        `Cannot revert: ${count} ledger entr${count === 1 ? "y is" : "ies are"} of kind contract_charge, and the ledger cannot delete entries.`,
      );
    }
    // The enum cannot lose a value in place: swap it for a new one. The four CHECKs that name the column hold the old
    // type inside them, so they are dropped and written again around the swap (same text as the migrations that made them).
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_adjustment_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_reversal_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_payment_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_applies_to_shape"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ledger_entry_kind_old" AS ENUM('rent', 'payment', 'adjustment', 'reversal')`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ALTER COLUMN "kind" TYPE "public"."ledger_entry_kind_old" USING "kind"::"text"::"public"."ledger_entry_kind_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."ledger_entry_kind"`);
    await queryRunner.query(
      `ALTER TYPE "public"."ledger_entry_kind_old" RENAME TO "ledger_entry_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_adjustment_shape" CHECK ("kind" <> 'adjustment' OR "created_by_id" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_shape" CHECK (("kind" = 'reversal') = ("reversal_of_id" IS NOT NULL) AND ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_shape" CHECK (("kind" <> 'payment' OR ("payment_id" IS NOT NULL AND "direction" = 'credit')) AND ("payment_id" IS NULL OR "kind" IN ('payment', 'reversal')))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_applies_to_shape" CHECK ("applies_to_id" IS NULL OR ("kind" = 'adjustment' AND "direction" = 'credit' AND "applies_to_id" <> "id"))`,
    );
  }
}
