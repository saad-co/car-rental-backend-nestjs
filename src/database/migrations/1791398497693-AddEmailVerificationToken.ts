import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerificationToken1791398497693 implements MigrationInterface {
  name = "AddEmailVerificationToken1791398497693";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verification_token_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_5dd2477e9857f8b66db49ecae4d" UNIQUE ("email_verification_token_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email_verification_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verification_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_5dd2477e9857f8b66db49ecae4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verification_token_hash"`,
    );
  }
}
