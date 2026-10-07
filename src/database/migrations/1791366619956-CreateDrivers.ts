import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDrivers1791366619956 implements MigrationInterface {
  name = "CreateDrivers1791366619956";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."driver_status" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "drivers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "email" character varying(254) NOT NULL, "phone" character varying(12) NOT NULL, "status" "public"."driver_status" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d4cfc1aafe3a14622aee390edb2" UNIQUE ("email"), CONSTRAINT "UQ_b97a5a68c766d2d1ec25e6a85b2" UNIQUE ("phone"), CONSTRAINT "drivers_phone_e164_us" CHECK ("phone" ~ '^\\+1[0-9]{10}$'), CONSTRAINT "drivers_email_lowercase" CHECK ("email" = lower("email")), CONSTRAINT "PK_92ab3fb69e566d3eb0cae896047" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drivers"`);
    await queryRunner.query(`DROP TYPE "public"."driver_status"`);
  }
}
