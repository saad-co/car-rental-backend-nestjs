import { MigrationInterface, QueryRunner } from "typeorm";

export class LedgerNotes1792417799873 implements MigrationInterface {
  name = "LedgerNotes1792417799873";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "description" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "internal_note" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "internal_note" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_manual_text_shape" CHECK (("description" IS NULL OR ("source" = 'manual' AND length(btrim("description")) BETWEEN 1 AND 500)) AND ("internal_note" IS NULL OR ("source" = 'manual' AND length(btrim("internal_note")) BETWEEN 1 AND 500)))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_internal_note_shape" CHECK ("internal_note" IS NULL OR length(btrim("internal_note")) BETWEEN 1 AND 500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_internal_note_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_manual_text_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "internal_note"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "internal_note"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "description"`);
  }
}
