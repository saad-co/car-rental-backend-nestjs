import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContractTracking1792589817460 implements MigrationInterface {
  name = "AddContractTracking1792589817460";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "status_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "signed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "signed_pdf_key" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "certificate_key" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "documents_error" text`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'viewed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'signed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'declined'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'expired'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'cancelled'`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD CONSTRAINT "contracts_documents_shape" CHECK (("signed_pdf_key" IS NULL) = ("certificate_key" IS NULL)
    AND ("signed_pdf_key" IS NULL OR "signed_at" IS NOT NULL))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "contracts" WHERE "status" NOT IN ('draft', 'sent')`,
    )) as [{ count: number }];
    if (count > 0) {
      throw new Error(
        `Cannot revert: ${count} contract(s) already follow firma (viewed, signed, declined, expired or cancelled), and the old schema has no place for that.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "contracts_documents_shape"`,
    );
    // The enum cannot lose values in place: swap it for a new one. Everything that names the column's type goes first and
    // comes back after (the draft-only index, the sent-shape CHECK, the default), as AddContractSending does.
    await queryRunner.query(
      `DROP INDEX "public"."contracts_one_draft_per_driver"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "contracts_sent_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contract_status_old" AS ENUM('draft', 'sent')`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" TYPE "public"."contract_status_old" USING "status"::"text"::"public"."contract_status_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."contract_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status_old" RENAME TO "contract_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sent_shape" CHECK (("status" = 'draft') = ("sent_at" IS NULL)
    AND ("sent_at" IS NULL) = ("firma_signing_request_id" IS NULL)
    AND ("sent_at" IS NULL) = ("sent_values" IS NULL))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contracts_one_draft_per_driver" ON "contracts" ("driver_id") WHERE "status" = 'draft'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "documents_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "certificate_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "signed_pdf_key"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "signed_at"`);
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "status_updated_at"`,
    );
  }
}
