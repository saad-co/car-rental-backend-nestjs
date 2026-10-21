import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContractSending1792583957001 implements MigrationInterface {
  name = "AddContractSending1792583957001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The state of each company's contract text, from the samples: the five rows are the ones AddContractDetails put in.
    await queryRunner.query(
      `ALTER TABLE "contract_companies" ADD "state" character(2)`,
    );
    await queryRunner.query(
      `UPDATE "contract_companies" SET "state" = CASE WHEN "address" LIKE '%, CA %' THEN 'CA' ELSE 'IL' END`,
    );
    await queryRunner.query(
      `ALTER TABLE "contract_companies" ALTER COLUMN "state" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD "sent_by_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "firma_signing_request_id" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD "sent_values" jsonb`);
    await queryRunner.query(
      `ALTER TYPE "public"."contract_status" ADD VALUE 'sent'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contracts_firma_signing_request_id" ON "contracts"  ("firma_signing_request_id") WHERE "firma_signing_request_id" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sent_shape" CHECK (("status" = 'draft') = ("sent_at" IS NULL)
    AND ("sent_at" IS NULL) = ("firma_signing_request_id" IS NULL)
    AND ("sent_at" IS NULL) = ("sent_values" IS NULL))`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_cc64d3a0f56b114139996f9995a" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "contracts" WHERE "status" <> 'draft'`,
    )) as [{ count: number }];
    if (count > 0) {
      throw new Error(
        `Cannot revert: ${count} contract(s) were already sent to firma, and the old schema has no place for them.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "FK_cc64d3a0f56b114139996f9995a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "contracts_sent_shape"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."contracts_firma_signing_request_id"`,
    );
    // The enum cannot lose a value in place: swap it for a new one. The draft-only index and the default name the old type.
    await queryRunner.query(
      `DROP INDEX "public"."contracts_one_draft_per_driver"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."contract_status_old" AS ENUM('draft')`,
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
    await queryRunner.query(
      `CREATE UNIQUE INDEX "contracts_one_draft_per_driver" ON "contracts" ("driver_id") WHERE "status" = 'draft'`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "sent_values"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "firma_signing_request_id"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "sent_by_id"`);
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "sent_at"`);
    await queryRunner.query(
      `ALTER TABLE "contract_companies" DROP COLUMN "state"`,
    );
  }
}
