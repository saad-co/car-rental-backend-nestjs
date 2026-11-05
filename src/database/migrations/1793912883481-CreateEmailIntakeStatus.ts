import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateEmailIntakeStatus1793912883481 implements MigrationInterface {
  name = "CreateEmailIntakeStatus1793912883481";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."email_intake_outcome" AS ENUM('ok', 'failed', 'off')`,
    );
    await queryRunner.query(
      `CREATE TABLE "email_intake_status" ("id" smallint NOT NULL, "last_run_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_outcome" "public"."email_intake_outcome" NOT NULL, "last_stored" integer NOT NULL DEFAULT '0', "last_success_at" TIMESTAMP WITH TIME ZONE, "last_error" text, CONSTRAINT "email_intake_status_stored_range" CHECK ("last_stored" >= 0), CONSTRAINT "email_intake_status_error_shape" CHECK (("last_outcome" = 'failed') = ("last_error" IS NOT NULL)), CONSTRAINT "email_intake_status_single_row" CHECK ("id" = 1), CONSTRAINT "PK_5c6bae73793401b299ae70041c5" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "email_intake_status"`);
    await queryRunner.query(`DROP TYPE "public"."email_intake_outcome"`);
  }
}
