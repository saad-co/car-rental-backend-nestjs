import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNameMatchMethod1791813633816 implements MigrationInterface {
  name = "AddNameMatchMethod1791813633816";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."payment_match_method" ADD VALUE 'name'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_match_method_old" AS ENUM('alias', 'ai', 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "match_method" TYPE "public"."payment_match_method_old" USING "match_method"::"text"::"public"."payment_match_method_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payment_match_method"`);
    await queryRunner.query(
      `ALTER TYPE "public"."payment_match_method_old" RENAME TO "payment_match_method"`,
    );
  }
}
