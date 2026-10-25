import { MigrationInterface, QueryRunner } from "typeorm";

export class AddArchiveAndApprovedWithoutDriver1792600000000 implements MigrationInterface {
  name = "AddArchiveAndApprovedWithoutDriver1792600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Archive is a flag, not a status (D80): null = not archived. Existing rows stay as they are (not archived).
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Approving no longer creates a driver (D80), so "approved" may now have no driver. The old rule was both ways
    // (approved <=> has a driver); only "a driver means approved" stays. Every existing row satisfies it.
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "applications_approved_has_driver"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "applications_driver_only_if_approved" CHECK ("driver_id" IS NULL OR "status" = 'approved')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "applications" WHERE "status" = 'approved' AND "driver_id" IS NULL`,
    )) as [{ count: number }];
    if (count > 0) {
      throw new Error(
        `Cannot revert: ${count} approved application(s) have no driver yet, and the old rule requires one.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "applications_driver_only_if_approved"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "applications_approved_has_driver" CHECK (("status" = 'approved') = ("driver_id" IS NOT NULL))`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "archived_at"`);
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "archived_at"`,
    );
  }
}
