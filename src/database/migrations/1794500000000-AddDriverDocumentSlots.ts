import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fleet revisions section 3: staff can add driver documents by hand. Two new kinds of file in `application_documents`:
 * the back of the driver's licence (`license_back`; the existing `license` slot is the front) and `other` files, up to 5
 * per driver, each with a label staff type.
 *
 * - `slot` (0 for every fixed kind, 1-5 for `other`) lets one driver hold several `other` rows; the unique key on
 *   `(driver_id, kind)` becomes `(driver_id, kind, slot)`.
 * - `label` is the name staff give an `other` file; required for it, and only for it.
 * The new kinds are never named as enum values in a constraint here: a value added in the same transaction cannot be
 * used yet, so the checks compare the kind as text.
 */
export class AddDriverDocumentSlots1794500000000 implements MigrationInterface {
  name = "AddDriverDocumentSlots1794500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_kind" ADD VALUE 'license_back'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."application_document_kind" ADD VALUE 'other'`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "slot" smallint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "label" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_driver_kind_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_driver_kind_key" UNIQUE ("driver_id", "kind", "slot")`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_slot_label" CHECK (("kind"::text = 'other' AND "slot" BETWEEN 1 AND 5 AND "label" IS NOT NULL AND length(btrim("label")) BETWEEN 1 AND 60) OR ("kind"::text <> 'other' AND "slot" = 0 AND "label" IS NULL))`,
    );
    // The back of the licence and the other files are always the driver's own, like the contract (D90): deleting an
    // application deletes its files (CASCADE), which must never take these with it.
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_driver_only_kinds" CHECK ("kind"::text NOT IN ('license_back', 'other') OR "driver_id" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "application_documents" WHERE "kind"::text IN ('license_back', 'other')`,
    )) as { n: number }[];
    if (n > 0) {
      throw new Error(
        `Cannot revert AddDriverDocumentSlots: ${n} licence-back or "Other" file(s) are stored. Remove them first (their files stay in the bucket).`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_driver_only_kinds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_slot_label"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_driver_kind_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_driver_kind_key" UNIQUE ("driver_id", "kind")`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "label"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "slot"`,
    );
    // The enum values cannot be dropped; the type is rebuilt.
    await queryRunner.query(
      `CREATE TYPE "public"."application_document_kind_old" AS ENUM('license', 'rating', 'earnings', 'contract')`,
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
