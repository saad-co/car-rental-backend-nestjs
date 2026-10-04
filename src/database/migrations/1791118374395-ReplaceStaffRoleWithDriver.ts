import { MigrationInterface, QueryRunner } from "typeorm";

export class ReplaceStaffRoleWithDriver1791118374395 implements MigrationInterface {
  name = "ReplaceStaffRoleWithDriver1791118374395";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."user_role" RENAME TO "user_role_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('admin', 'driver')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role" USING "role"::"text"::"public"."user_role"`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_role_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_role_old" AS ENUM('admin', 'staff')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role_old" USING "role"::"text"::"public"."user_role_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'staff'`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
    await queryRunner.query(
      `ALTER TYPE "public"."user_role_old" RENAME TO "user_role"`,
    );
  }
}
