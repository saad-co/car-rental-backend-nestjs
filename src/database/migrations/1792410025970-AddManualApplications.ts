import { MigrationInterface, QueryRunner } from "typeorm";

export class AddManualApplications1792410025970 implements MigrationInterface {
  name = "AddManualApplications1792410025970";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "applications" ADD "created_by_id" uuid`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_origin" AS ENUM('website', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "origin" "public"."application_document_origin" NOT NULL DEFAULT 'website'`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "uploaded_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "source_path" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_origin_shape" CHECK (("origin" = 'website' AND "source_path" IS NOT NULL) OR ("origin" = 'admin' AND "status" = 'stored'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" ADD CONSTRAINT "FK_016172eee065ce6641cebc850b4" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "FK_572badf3dd8bc6d642c8785d8ab" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // An admin upload has no website path, so it cannot go back into a NOT NULL `source_path`. Refuse loudly
    // instead of failing half way, or deleting someone's files.
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "application_documents" WHERE "origin" = 'admin'`,
    )) as { count: number }[];
    if (count > 0) {
      throw new Error(
        `Cannot revert AddManualApplications: ${count} document(s) were uploaded by an admin and have no website path. Delete them first if you really mean to go back.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "FK_572badf3dd8bc6d642c8785d8ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "applications" DROP CONSTRAINT "FK_016172eee065ce6641cebc850b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_origin_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "source_path" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "uploaded_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "origin"`,
    );
    await queryRunner.query(`DROP TYPE "public"."application_document_origin"`);
    await queryRunner.query(
      `ALTER TABLE "applications" DROP COLUMN "created_by_id"`,
    );
  }
}
