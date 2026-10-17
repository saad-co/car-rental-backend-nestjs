import { MigrationInterface, QueryRunner } from "typeorm";

export class AddApplicationAlert1791999510948 implements MigrationInterface {
  name = "AddApplicationAlert1791999510948";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "alerted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "alert_error" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "alert_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "alerted_at"`,
    );
  }
}
