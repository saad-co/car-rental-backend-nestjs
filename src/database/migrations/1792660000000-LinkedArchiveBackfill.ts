import { MigrationInterface, QueryRunner } from "typeorm";

export class LinkedArchiveBackfill1792660000000 implements MigrationInterface {
  name = "LinkedArchiveBackfill1792660000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // D84: an application is archived together with its driver. Until now an application could not be archived while
    // its driver was active or inactive, so the application of a driver archived on the Drivers page was left
    // unarchived and would still be listed. Copy the driver's archive time to it. The other direction needs nothing:
    // an archived application never had an active or inactive driver, and onboarding pairs were archived together.
    await queryRunner.query(
      `UPDATE "applications" a SET "archived_at" = d."archived_at"
       FROM "drivers" d
       WHERE a."driver_id" = d."id" AND d."archived_at" IS NOT NULL AND a."archived_at" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    // Nothing to undo: the rows the backfill changed cannot be told apart from applications an admin archived
    // together with their driver afterwards, and un-archiving an application by hand is always possible.
  }
}
