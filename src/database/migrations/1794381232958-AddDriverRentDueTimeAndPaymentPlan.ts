import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverRentDueTimeAndPaymentPlan1794381232958 implements MigrationInterface {
  name = "AddDriverRentDueTimeAndPaymentPlan1794381232958";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD "rent_due_time" TIME`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "on_payment_plan" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "drivers_rent_due_time_minute" CHECK ("rent_due_time" IS NULL OR date_part('second', "rent_due_time") = 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "drivers_rent_due_time_minute"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "on_payment_plan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "rent_due_time"`,
    );
  }
}
