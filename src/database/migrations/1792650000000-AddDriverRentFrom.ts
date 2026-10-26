import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverRentFrom1792650000000 implements MigrationInterface {
  name = "AddDriverRentFrom1792650000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD "rent_from" date`);
    // A driver who is active today has been since their last onboarding step (the CHECK needs all three), as a Chicago day.
    await queryRunner.query(
      `UPDATE "drivers" SET "rent_from" = (GREATEST("contract_signed_at", "deposit_paid_at", "vehicle_assigned_at") AT TIME ZONE 'America/Chicago')::date WHERE "status" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "rent_from"`);
  }
}
