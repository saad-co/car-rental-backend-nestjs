import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fleet revisions section 4: an approved application can now be deleted. Its driver stays, and the driver's licence,
 * rating and earnings files were the application's rows, so they are handed to the driver instead of being deleted with
 * the application. Those rows keep their `website` origin and path, which the old check refused for a driver-owned row
 * ("the website never sends files for a driver"). The check now only demands one owner; the other checks (stored files
 * have a file, a website row has its path) still apply.
 */
export class AllowWebsiteDocumentsOnDriver1794500200000 implements MigrationInterface {
  name = "AllowWebsiteDocumentsOnDriver1794500200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_one_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_one_owner" CHECK (("application_id" IS NULL) <> ("driver_id" IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "application_documents" WHERE "driver_id" IS NOT NULL AND "origin" = 'website'`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `Cannot revert AllowWebsiteDocumentsOnDriver: ${n} website file(s) are kept on a driver. Remove them first.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_one_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_one_owner" CHECK (("application_id" IS NULL) <> ("driver_id" IS NULL) AND ("driver_id" IS NULL OR "origin" <> 'website'))`,
    );
  }
}
