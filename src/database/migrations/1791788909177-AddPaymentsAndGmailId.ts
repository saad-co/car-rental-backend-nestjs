import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentsAndGmailId1791788909177 implements MigrationInterface {
  name = "AddPaymentsAndGmailId1791788909177";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_source" AS ENUM('email_zelle', 'email_cashapp', 'email_venmo', 'email_stripe', 'email_chime', 'plaid_zelle', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_status" AS ENUM('reported', 'confirmed', 'unmatched', 'rejected', 'discrepancy')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "source" "public"."payment_source" NOT NULL, "external_id" character varying(255) NOT NULL, "transaction_id" character varying(255), "amount_cents" integer NOT NULL, "sender_name" character varying(255) NOT NULL, "sender_handle" character varying(255), "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "extraction_confidence" real, "status" "public"."payment_status" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "payments_source_transaction_id_key" UNIQUE ("source", "transaction_id"), CONSTRAINT "payments_source_external_id_key" UNIQUE ("source", "external_id"), CONSTRAINT "payments_confidence_range" CHECK ("extraction_confidence" IS NULL OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1)), CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" > 0), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ADD "gmail_message_id" character varying(32) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."inbound_email_status" ADD VALUE 'duplicate_payment'`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_gmail_message_key" UNIQUE ("mailbox", "gmail_message_id")`,
    );
    // Written by hand: TypeORM does not detect a changed CHECK. The new status needs a reason too.
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" DROP CONSTRAINT "inbound_emails_failure_has_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_failure_has_reason" CHECK ("status"::text NOT IN ('rejected_unverified', 'extraction_failed', 'duplicate_payment') OR "status_reason" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Undo the hand-written CHECK first (it must not exist while the status type is swapped).
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" DROP CONSTRAINT "inbound_emails_failure_has_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" DROP CONSTRAINT "inbound_emails_gmail_message_key"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inbound_email_status_old" AS ENUM('processed', 'rejected_unverified', 'extraction_failed', 'not_payment')`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ALTER COLUMN "status" TYPE "public"."inbound_email_status_old" USING "status"::"text"::"public"."inbound_email_status_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."inbound_email_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."inbound_email_status_old" RENAME TO "inbound_email_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_failure_has_reason" CHECK ("status" NOT IN ('rejected_unverified', 'extraction_failed') OR "status_reason" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" DROP COLUMN "gmail_message_id"`,
    );
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "public"."payment_status"`);
    await queryRunner.query(`DROP TYPE "public"."payment_source"`);
  }
}
