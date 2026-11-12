import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Payment reminders (Fleet revisions section 6, the original M6; PHASE1_SPEC section 8):
 * - `app_settings`: a small key/value table (spec section 4 `Setting`) for the reminders switch and the payment link;
 * - on `drivers`: `sms_opted_out` (the driver texted STOP: never text them; spec sections 4 and 8, never built before),
 *   the two per-driver switches (upcoming and balance reminders, on by default) and the start of the
 *   driver's current "behind" episode (written by the reminder job: it makes "each threshold sends once" mean once per
 *   time the driver falls behind, not once per lifetime);
 * - `reminder_logs`: every reminder composed, sent or failed, shown on the driver's page. `dedupe_key` is unique per mode
 *   among the ones that did not fail, so the same reminder can never go out twice, a dry run never blocks the live send,
 *   and a failed send can be tried again;
 * - the default texts of the five new kinds in `message_templates`.
 */
export class CreateReminders1794500500000 implements MigrationInterface {
  name = "CreateReminders1794500500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "app_settings" ("key" character varying(60) NOT NULL, "value" text NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_by_id" uuid, CONSTRAINT "PK_app_settings" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "app_settings" ADD CONSTRAINT "FK_app_settings_updated_by" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "sms_opted_out" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "upcoming_reminders_enabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "balance_reminders_enabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "late_episode_started_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `CREATE TABLE "reminder_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "kind" character varying(30) NOT NULL, "tier" smallint, "dedupe_key" character varying(120) NOT NULL, "mode" character varying(10) NOT NULL, "status" character varying(10) NOT NULL, "error" text, "body" text NOT NULL, "past_due_cents" integer NOT NULL, "balance_cents" integer NOT NULL, "sms_message_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "reminder_logs_kind" CHECK ("kind" IN ('upcoming', 'late', 'high_balance', 'balance', 'payment_received')), CONSTRAINT "reminder_logs_mode" CHECK ("mode" IN ('dry_run', 'live')), CONSTRAINT "reminder_logs_status" CHECK ("status" IN ('sent', 'composed', 'failed')), CONSTRAINT "reminder_logs_failed_has_error" CHECK ("status" <> 'failed' OR "error" IS NOT NULL), CONSTRAINT "PK_reminder_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "reminder_logs_dedupe_key" ON "reminder_logs" ("dedupe_key", "mode") WHERE "status" <> 'failed'`,
    );
    await queryRunner.query(
      `CREATE INDEX "reminder_logs_driver_created_idx" ON "reminder_logs" ("driver_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminder_logs" ADD CONSTRAINT "FK_reminder_logs_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reminder_logs" ADD CONSTRAINT "FK_reminder_logs_sms_message" FOREIGN KEY ("sms_message_id") REFERENCES "sms_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `INSERT INTO "message_templates" ("kind", "name", "body") VALUES
        ('reminder_upcoming', 'Default', 'Hi {firstName}, a friendly reminder: your rent payment of {amount} is due {due}.' || chr(10) || 'You can pay here: {paymentLink}'),
        ('reminder_late', 'Default', 'Hi {firstName}, we have not received your latest rent payment yet. Your past-due balance is {balance}. Please catch up when you can.' || chr(10) || 'You can pay here: {paymentLink}'),
        ('reminder_high_balance', 'Default', 'Hi {firstName}, you are now {missedCount} payments behind (past due: {balance}). Please catch up soon so we can avoid a possible interruption of your service.' || chr(10) || 'You can pay here: {paymentLink}'),
        ('reminder_balance', 'Default', 'Hi {firstName}, a friendly reminder that your past-due balance is {balance}. Thank you for staying on top of it!' || chr(10) || 'You can pay here: {paymentLink}'),
        ('reminder_payment_received', 'Default', 'Thank you {firstName}, we received your payment. Your remaining past-due balance is {balance}.' || chr(10) || 'You can pay here: {paymentLink}')
       ON CONFLICT ("kind", "name") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "message_templates" WHERE "kind" IN ('reminder_upcoming', 'reminder_late', 'reminder_high_balance', 'reminder_balance', 'reminder_payment_received')`,
    );
    await queryRunner.query(`DROP TABLE "reminder_logs"`);
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "late_episode_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "balance_reminders_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "upcoming_reminders_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "sms_opted_out"`,
    );
    await queryRunner.query(`DROP TABLE "app_settings"`);
  }
}
