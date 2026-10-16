import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Message templates (B73, D58): the table, and the two default texts so they exist as soon as this runs (staging
 * included). The defaults are placeholders for the client to edit in Settings; the decline text has a visible
 * "[add …]" marker so the other companies' numbers are not forgotten.
 *
 * Edited after generation: the INSERT of the defaults. They are written here, not imported from app code, so this
 * migration always does the same thing even if the app's code changes later.
 */
export class CreateMessageTemplates1792187371134 implements MigrationInterface {
  name = "CreateMessageTemplates1792187371134";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "message_templates" ("key" character varying(50) NOT NULL, "body" text NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_by_id" uuid, CONSTRAINT "message_templates_body_length" CHECK (length(btrim("body")) BETWEEN 1 AND 1000), CONSTRAINT "PK_08578117c79ed6c5c7f5f96588f" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_templates" ADD CONSTRAINT "FK_a795a72a02126873f4a5609ad8f" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `INSERT INTO "message_templates" ("key", "body") VALUES ($1, $2), ($3, $4)`,
      [
        "application_approved",
        "Hi {firstName}, this is GonzoCar. Your application is approved! You will get a second text with your driver login. Next we will contact you to sign your rental contract, take your deposit and set up your vehicle. Questions? Just reply to this text.",
        "application_declined",
        "Hi {firstName}, this is GonzoCar. Thank you for applying. Unfortunately we cannot offer you a rental at this time. You may want to contact other rental companies: [add company names and phone numbers here]. We wish you all the best.",
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_templates" DROP CONSTRAINT "FK_a795a72a02126873f4a5609ad8f"`,
    );
    await queryRunner.query(`DROP TABLE "message_templates"`);
  }
}
