import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStripeChimeProviders1791572059948 implements MigrationInterface {
  name = "AddStripeChimeProviders1791572059948";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."inbound_email_provider" ADD VALUE 'stripe'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."inbound_email_provider" ADD VALUE 'chime'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."inbound_email_provider_old" AS ENUM('cashapp', 'venmo', 'zelle_chase', 'unknown')`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound_emails" ALTER COLUMN "provider" TYPE "public"."inbound_email_provider_old" USING "provider"::"text"::"public"."inbound_email_provider_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."inbound_email_provider"`);
    await queryRunner.query(
      `ALTER TYPE "public"."inbound_email_provider_old" RENAME TO "inbound_email_provider"`,
    );
  }
}
