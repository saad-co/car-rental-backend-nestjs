import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateApplicationNotes1792185993624 implements MigrationInterface {
  name = "CreateApplicationNotes1792185993624";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "application_notes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "application_id" uuid NOT NULL, "author_id" uuid, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "application_notes_body_length" CHECK (length(btrim("body")) BETWEEN 1 AND 2000), CONSTRAINT "PK_db708de5fa99541ad52a1f907de" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "application_notes_application_created_idx" ON "application_notes"  ("application_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "application_notes" ADD CONSTRAINT "FK_1a5375c61bc031bba625c02096d" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_notes" ADD CONSTRAINT "FK_06841db9526c0d17f97cdc46551" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "application_notes" DROP CONSTRAINT "FK_06841db9526c0d17f97cdc46551"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_notes" DROP CONSTRAINT "FK_1a5375c61bc031bba625c02096d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."application_notes_application_created_idx"`,
    );
    await queryRunner.query(`DROP TABLE "application_notes"`);
  }
}
