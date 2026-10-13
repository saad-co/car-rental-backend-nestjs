import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentMatching1791812908004 implements MigrationInterface {
  name = "AddPaymentMatching1791812908004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "driver_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "suggested_driver_id" uuid`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_match_method" AS ENUM('alias', 'ai', 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "match_method" "public"."payment_match_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "match_confidence" real`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "match_explanation" text`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ADD "matched_by_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "match_attempted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "payments_driver_idx" ON "payments"  ("driver_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_match_confidence_range" CHECK ("match_confidence" IS NULL OR ("match_confidence" >= 0 AND "match_confidence" <= 1))`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "payments_driver_has_method" CHECK (("driver_id" IS NULL) = ("match_method" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_1011df5653b62cccb53aa1d0079" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_acdb3417535790532ac408c0896" FOREIGN KEY ("suggested_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_6a10f9e1f1ca12f68828fb794b0" FOREIGN KEY ("matched_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_6a10f9e1f1ca12f68828fb794b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_acdb3417535790532ac408c0896"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_1011df5653b62cccb53aa1d0079"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_driver_has_method"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "payments_match_confidence_range"`,
    );
    await queryRunner.query(`DROP INDEX "public"."payments_driver_idx"`);
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "match_attempted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "matched_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "match_explanation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "match_confidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "match_method"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payment_match_method"`);
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN "suggested_driver_id"`,
    );
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "driver_id"`);
  }
}
