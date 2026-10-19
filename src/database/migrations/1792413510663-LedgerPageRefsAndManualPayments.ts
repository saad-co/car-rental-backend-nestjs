import { MigrationInterface, QueryRunner } from "typeorm";

export class LedgerPageRefsAndManualPayments1792413510663 implements MigrationInterface {
  name = "LedgerPageRefsAndManualPayments1792413510663";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_manual_method" AS ENUM('zelle', 'cash_app', 'venmo', 'stripe', 'chime', 'cash', 'check', 'card', 'money_order', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "manual_method" "public"."payment_manual_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "entry_no" bigint GENERATED ALWAYS AS IDENTITY NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "UQ_efddab85bc59292740f3ac9fc47" UNIQUE ("entry_no")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "applies_to_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "ledger_entries_applies_to_idx" ON "ledger_entries"  ("applies_to_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_manual_method_shape" CHECK ("manual_method" IS NULL OR "source" = 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_applies_to_shape" CHECK ("applies_to_id" IS NULL OR ("kind" = 'adjustment' AND "direction" = 'credit' AND "applies_to_id" <> "id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "FK_17a533a5bdd18d7ac7e63c62344" FOREIGN KEY ("applies_to_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "FK_17a533a5bdd18d7ac7e63c62344"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_applies_to_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_manual_method_shape"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ledger_entries_applies_to_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "applies_to_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "UQ_efddab85bc59292740f3ac9fc47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "entry_no"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "manual_method"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payment_manual_method"`);
  }
}
