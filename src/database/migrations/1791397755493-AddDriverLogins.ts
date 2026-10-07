import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverLogins1791397755493 implements MigrationInterface {
  name = "AddDriverLogins1791397755493";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "must_change_password" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD "user_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "UQ_8e224f1b8f05ace7cfc7c76d03b" UNIQUE ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_8e224f1b8f05ace7cfc7c76d03b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_8e224f1b8f05ace7cfc7c76d03b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "UQ_8e224f1b8f05ace7cfc7c76d03b"`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "user_id"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "must_change_password"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verified_at"`,
    );
  }
}
