import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateApplications1791368432368 implements MigrationInterface {
  name = "CreateApplications1791368432368";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."application_status" AS ENUM('pending', 'approved', 'rejected', 'on_hold')`,
    );
    await queryRunner.query(
      `CREATE TABLE "applications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "request_id" character varying(100) NOT NULL, "status" "public"."application_status" NOT NULL DEFAULT 'pending', "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "email" character varying(254) NOT NULL, "phone" character varying(30) NOT NULL, "city" character varying(100), "zip" character varying(10), "submitted_at" TIMESTAMP WITH TIME ZONE, "license_storage_path" character varying(500), "rating_storage_path" character varying(500), "earnings_storage_path" character varying(500), "payload" jsonb NOT NULL, "reviewed_by_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "driver_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_05f170bca858386a2d5943c1962" UNIQUE ("request_id"), CONSTRAINT "REL_1cb17054f38a47e88f5b6795f7" UNIQUE ("driver_id"), CONSTRAINT "applications_approved_has_driver" CHECK (("status" = 'approved') = ("driver_id" IS NOT NULL)), CONSTRAINT "applications_email_lowercase" CHECK ("email" = lower("email")), CONSTRAINT "PK_938c0a27255637bde919591888f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_7b8cdcaabacb80df1ed8f7dbbea" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_1cb17054f38a47e88f5b6795f78" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_1cb17054f38a47e88f5b6795f78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_7b8cdcaabacb80df1ed8f7dbbea"`,
    );
    await queryRunner.query(`DROP TABLE "applications"`);
    await queryRunner.query(`DROP TYPE "public"."application_status"`);
  }
}
