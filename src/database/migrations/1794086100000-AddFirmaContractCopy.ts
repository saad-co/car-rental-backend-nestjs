import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D90 step 2: the signed PDF of a firma contract is copied into the driver's contract slot (`application_documents`,
 * kind `contract`).
 *
 * - `contract_id`: which firma contract the copy came from (null for an admin upload). Unique: a contract is filed once.
 *   `ON DELETE SET NULL`: the copy is its own file and outlives the link.
 * - New origin `firma`. Postgres does not let a CHECK use an enum value added in the same transaction (and `migration:run`
 *   runs all pending migrations in one), so the two checks that named `'admin'` are rewritten as "not the website":
 *   they never name `firma`. TypeORM compares checks by name only, so it would not notice these changes: they are written here.
 * - A contract link is only allowed on a driver-owned row.
 */
export class AddFirmaContractCopy1794086100000 implements MigrationInterface {
  name = "AddFirmaContractCopy1794086100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_origin" ADD VALUE 'firma'`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "contract_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "UQ_ef7d3d5b23d715cd295121e9f1a" UNIQUE ("contract_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "FK_ef7d3d5b23d715cd295121e9f1a" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_one_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_one_owner" CHECK (("application_id" IS NULL) <> ("driver_id" IS NULL) AND ("driver_id" IS NULL OR "origin" <> 'website'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_origin_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_origin_shape" CHECK (("origin" = 'website' AND "source_path" IS NOT NULL) OR ("origin" <> 'website' AND "status" = 'stored'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_contract_link" CHECK ("contract_id" IS NULL OR "driver_id" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Copies from firma cannot be converted back to an origin that no longer exists: refuse loudly instead of deleting them.
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "application_documents" WHERE "origin"::text = 'firma'`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `Cannot revert AddFirmaContractCopy: ${n} contract copy file(s) from firma are filed. Remove them first (their files stay in the bucket).`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_contract_link"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_origin_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_one_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "FK_ef7d3d5b23d715cd295121e9f1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "UQ_ef7d3d5b23d715cd295121e9f1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "contract_id"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_origin_old" AS ENUM('website', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "origin" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "origin" TYPE "public"."application_document_origin_old" USING "origin"::"text"::"public"."application_document_origin_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "origin" SET DEFAULT 'website'`,
    );
    await queryRunner.query(`DROP TYPE "public"."application_document_origin"`);
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_origin_old" RENAME TO "application_document_origin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_one_owner" CHECK (("application_id" IS NULL) <> ("driver_id" IS NULL) AND ("driver_id" IS NULL OR "origin" = 'admin'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_origin_shape" CHECK (("origin" = 'website' AND "source_path" IS NOT NULL) OR ("origin" = 'admin' AND "status" = 'stored'))`,
    );
  }
}
