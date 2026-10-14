import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSms1791977776583 implements MigrationInterface {
  name = "CreateSms1791977776583";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."sms_direction" AS ENUM('inbound', 'outbound')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sms_mode" AS ENUM('dry_run', 'live')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sms_status" AS ENUM('composed', 'queued', 'sent', 'delivered', 'undelivered', 'failed', 'received')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sms_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "quo_message_id" character varying(100), "direction" "public"."sms_direction" NOT NULL, "contact_phone" character varying(16) NOT NULL, "body" text NOT NULL, "mode" "public"."sms_mode", "status" "public"."sms_status" NOT NULL, "error" text, "sent_by_id" uuid, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "sms_messages_failure_has_error" CHECK ("status" NOT IN ('failed', 'undelivered') OR "error" IS NOT NULL), CONSTRAINT "sms_messages_dry_run_has_no_quo_id" CHECK ("mode" IS DISTINCT FROM 'dry_run' OR "quo_message_id" IS NULL), CONSTRAINT "sms_messages_dry_run_is_composed" CHECK (COALESCE("mode" = 'dry_run', false) = ("status" = 'composed')), CONSTRAINT "sms_messages_outbound_has_mode" CHECK (("direction" = 'outbound') = ("mode" IS NOT NULL)), CONSTRAINT "sms_messages_inbound_is_received" CHECK (("direction" = 'inbound') = ("status" = 'received')), CONSTRAINT "sms_messages_phone_e164" CHECK ("contact_phone" ~ '^\\+[1-9][0-9]{6,14}$'), CONSTRAINT "PK_6d4cfef86e93e3fde23954d11bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "sms_messages_contact_idx" ON "sms_messages"  ("contact_phone", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "sms_messages_quo_message_id_key" ON "sms_messages"  ("quo_message_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sms_attachment_status" AS ENUM('pending', 'stored', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sms_attachments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "message_id" uuid NOT NULL, "position" integer NOT NULL, "source_url" text NOT NULL, "content_type" character varying(150), "size_bytes" integer, "status" "public"."sms_attachment_status" NOT NULL DEFAULT 'pending', "storage_key" character varying(300), "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "sms_attachments_message_position_key" UNIQUE ("message_id", "position"), CONSTRAINT "sms_attachments_failed_has_error" CHECK ("status" <> 'failed' OR "last_error" IS NOT NULL), CONSTRAINT "sms_attachments_stored_has_file" CHECK ("status" <> 'stored' OR ("storage_key" IS NOT NULL AND "size_bytes" IS NOT NULL)), CONSTRAINT "PK_1baeea0c3b75318f820d673f5f4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_messages" ADD CONSTRAINT "FK_cbd0bb587f48c24ed912ed96e51" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_attachments" ADD CONSTRAINT "FK_8d1ec0e75b926c8a2ee6847185e" FOREIGN KEY ("message_id") REFERENCES "sms_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sms_attachments" DROP CONSTRAINT "FK_8d1ec0e75b926c8a2ee6847185e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_messages" DROP CONSTRAINT "FK_cbd0bb587f48c24ed912ed96e51"`,
    );
    await queryRunner.query(`DROP TABLE "sms_attachments"`);
    await queryRunner.query(`DROP TYPE "public"."sms_attachment_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."sms_messages_quo_message_id_key"`,
    );
    await queryRunner.query(`DROP INDEX "public"."sms_messages_contact_idx"`);
    await queryRunner.query(`DROP TABLE "sms_messages"`);
    await queryRunner.query(`DROP TYPE "public"."sms_status"`);
    await queryRunner.query(`DROP TYPE "public"."sms_mode"`);
    await queryRunner.query(`DROP TYPE "public"."sms_direction"`);
  }
}
