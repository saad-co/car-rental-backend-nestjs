import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateApplicationDocuments1792002866910 implements MigrationInterface {
  name = "CreateApplicationDocuments1792002866910";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_kind" AS ENUM('license', 'rating', 'earnings')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_status" AS ENUM('pending', 'stored', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "application_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "application_id" uuid NOT NULL, "kind" "public"."application_document_kind" NOT NULL, "source_path" text NOT NULL, "content_type" character varying(150), "size_bytes" integer, "status" "public"."application_document_status" NOT NULL DEFAULT 'pending', "storage_key" character varying(300), "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "application_documents_application_kind_key" UNIQUE ("application_id", "kind"), CONSTRAINT "application_documents_failed_has_error" CHECK ("status" <> 'failed' OR "last_error" IS NOT NULL), CONSTRAINT "application_documents_stored_has_file" CHECK ("status" <> 'stored' OR ("storage_key" IS NOT NULL AND "size_bytes" IS NOT NULL)), CONSTRAINT "PK_592142aa992e003beadf1409e9e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "FK_9ad8ab815e842d67e9aaec900cb" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "FK_9ad8ab815e842d67e9aaec900cb"`,
    );
    await queryRunner.query(`DROP TABLE "application_documents"`);
    await queryRunner.query(`DROP TYPE "public"."application_document_status"`);
    await queryRunner.query(`DROP TYPE "public"."application_document_kind"`);
  }
}
