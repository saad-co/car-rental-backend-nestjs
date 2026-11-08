import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * D90: a driver's signed contract is one more kind of file in `application_documents` (next to licence, rating and
 * earnings). Adds the enum value only; no row changes, and the table's constraints already allow a driver-owned row.
 */
export class AddContractDocumentKind1794086000000 implements MigrationInterface {
  name = "AddContractDocumentKind1794086000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_kind" ADD VALUE 'contract'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A value cannot be dropped from an enum, so the type is rebuilt. Stored contracts cannot be converted: refuse
    // loudly instead of deleting them (their files would be left orphaned in the bucket).
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "application_documents" WHERE "kind" = 'contract'`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `Cannot revert AddContractDocumentKind: ${n} signed contract file(s) are stored. Remove them first (their files stay in the bucket).`,
      );
    }
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_kind_old" AS ENUM('license', 'rating', 'earnings')`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "kind" TYPE "public"."application_document_kind_old" USING "kind"::"text"::"public"."application_document_kind_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."application_document_kind"`);
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_kind_old" RENAME TO "application_document_kind"`,
    );
  }
}
