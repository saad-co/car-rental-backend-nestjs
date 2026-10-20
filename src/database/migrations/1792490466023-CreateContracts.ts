import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateContracts1792490466023 implements MigrationInterface {
  name = "CreateContracts1792490466023";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contract_status" AS ENUM('draft')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contract_schedule" AS ENUM('weekly', 'daily')`,
    );
    await queryRunner.query(`CREATE TABLE "contracts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "driver_id" uuid NOT NULL, "status" "public"."contract_status" NOT NULL DEFAULT 'draft', "schedule" "public"."contract_schedule" NOT NULL, "total_rate_cents" integer NOT NULL, "start_date" date NOT NULL, "term_months" smallint NOT NULL DEFAULT '18', "security_deposit_cents" integer NOT NULL DEFAULT '0', "documentation_fee_cents" integer NOT NULL DEFAULT '0', "insurance_start_fee_cents" integer NOT NULL DEFAULT '0', "other_one_time_cents" integer NOT NULL DEFAULT '0', "hold_vehicle_cents" integer NOT NULL DEFAULT '0', "excess_mileage_cents" integer NOT NULL DEFAULT '0', "insurance_excess_cents" integer NOT NULL DEFAULT '0', "other_recurring_cents" integer NOT NULL DEFAULT '0', "created_by_id" uuid, "updated_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "contracts_term_range" CHECK ("term_months" BETWEEN 1 AND 60), CONSTRAINT "contracts_charges_range" CHECK ("security_deposit_cents" BETWEEN 0 AND 1000000
    AND "documentation_fee_cents" BETWEEN 0 AND 1000000
    AND "insurance_start_fee_cents" BETWEEN 0 AND 1000000
    AND "other_one_time_cents" BETWEEN 0 AND 1000000
    AND "hold_vehicle_cents" BETWEEN 0 AND 1000000
    AND "excess_mileage_cents" BETWEEN 0 AND 1000000
    AND "insurance_excess_cents" BETWEEN 0 AND 1000000
    AND "other_recurring_cents" BETWEEN 0 AND 1000000), CONSTRAINT "contracts_total_rate_range" CHECK ("total_rate_cents" BETWEEN 1 AND 1000000), CONSTRAINT "PK_2c7b8f3a7b1acdd49497d83d0fb" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contracts_one_draft_per_driver" ON "contracts"  ("driver_id") WHERE "status" = 'draft'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_0d457fc85b6b8794ffe482d081c" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_310a75ab7fb103ae6383b7b08d1" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_2aa7a58dcfb7ebf4f134964f77d" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "FK_2aa7a58dcfb7ebf4f134964f77d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "FK_310a75ab7fb103ae6383b7b08d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "FK_0d457fc85b6b8794ffe482d081c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."contracts_one_draft_per_driver"`,
    );
    await queryRunner.query(`DROP TABLE "contracts"`);
    await queryRunner.query(`DROP TYPE "public"."contract_schedule"`);
    await queryRunner.query(`DROP TYPE "public"."contract_status"`);
  }
}
