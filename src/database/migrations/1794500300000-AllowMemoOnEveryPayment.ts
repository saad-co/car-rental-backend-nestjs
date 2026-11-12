import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fleet revisions section 5: every ledger entry can carry a staff memo, a payment from an email included. The old check
 * allowed `internal_note` only on payments recorded by hand. The staff note stays internal (never on the statement).
 * `description` is still only for payments recorded by hand: an email payment's text is built from its sender.
 */
export class AllowMemoOnEveryPayment1794500300000 implements MigrationInterface {
  name = "AllowMemoOnEveryPayment1794500300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_manual_text_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_manual_text_shape" CHECK (("description" IS NULL OR ("source" = 'manual' AND length(btrim("description")) BETWEEN 1 AND 500)) AND ("internal_note" IS NULL OR length(btrim("internal_note")) BETWEEN 1 AND 500))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "payments" WHERE "internal_note" IS NOT NULL AND "source" <> 'manual'`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `Cannot revert AllowMemoOnEveryPayment: ${n} payment(s) that came from an email carry a memo. Clear them first.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_manual_text_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_manual_text_shape" CHECK (("description" IS NULL OR ("source" = 'manual' AND length(btrim("description")) BETWEEN 1 AND 500)) AND ("internal_note" IS NULL OR ("source" = 'manual' AND length(btrim("internal_note")) BETWEEN 1 AND 500)))`,
    );
  }
}
