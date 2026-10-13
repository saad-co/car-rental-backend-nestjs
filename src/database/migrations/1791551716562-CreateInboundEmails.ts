import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInboundEmails1791551716562 implements MigrationInterface {
  name = "CreateInboundEmails1791551716562";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."inbound_email_provider" AS ENUM('cashapp', 'venmo', 'zelle_chase', 'unknown')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inbound_email_status" AS ENUM('processed', 'rejected_unverified', 'extraction_failed', 'not_payment')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inbound_emails" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "mailbox" character varying(254) NOT NULL, "imap_uid_validity" bigint NOT NULL, "imap_uid" bigint NOT NULL, "message_id" character varying(998), "from_address" character varying(254), "subject" text NOT NULL DEFAULT '', "received_at" TIMESTAMP WITH TIME ZONE NOT NULL, "auth_dkim_pass" boolean NOT NULL, "auth_dkim_domain" character varying(255), "provider" "public"."inbound_email_provider" NOT NULL, "status" "public"."inbound_email_status" NOT NULL, "status_reason" text, "body_text" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "inbound_emails_message_key" UNIQUE ("mailbox", "imap_uid_validity", "imap_uid"), CONSTRAINT "inbound_emails_failure_has_reason" CHECK ("status" NOT IN ('rejected_unverified', 'extraction_failed') OR "status_reason" IS NOT NULL), CONSTRAINT "inbound_emails_uid_positive" CHECK ("imap_uid" > 0), CONSTRAINT "inbound_emails_mailbox_lowercase" CHECK ("mailbox" = lower("mailbox")), CONSTRAINT "PK_4681d4ed00f370f44de2a1d094c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "inbound_emails_received_at_idx" ON "inbound_emails"  ("received_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."inbound_emails_received_at_idx"`,
    );
    await queryRunner.query(`DROP TABLE "inbound_emails"`);
    await queryRunner.query(`DROP TYPE "public"."inbound_email_status"`);
    await queryRunner.query(`DROP TYPE "public"."inbound_email_provider"`);
  }
}
