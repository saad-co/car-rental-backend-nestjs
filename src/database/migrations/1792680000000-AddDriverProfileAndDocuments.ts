import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverProfileAndDocuments1792680000000 implements MigrationInterface {
  name = "AddDriverProfileAndDocuments1792680000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // D85: the profile moves onto the driver, so a driver added without an application has somewhere to keep it.
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "middle_name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "street" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "apt" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "city" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "state" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "zip" character varying(10)`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD "date_of_birth" date`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "has_insurance" boolean`,
    );

    // Drivers that already exist and came from an application get what that application holds. The website form has no
    // middle name, state or date of birth, so those stay empty. `has_insurance` is only "yes" or "no" on the website;
    // anything else stays unknown. Values are cut to the column sizes (the form's own limits are the same or smaller).
    await queryRunner.query(
      `UPDATE "drivers" d SET
         "street" = LEFT(NULLIF(BTRIM(a."payload"->>'street'), ''), 200),
         "apt" = LEFT(NULLIF(BTRIM(a."payload"->>'apt'), ''), 50),
         "city" = LEFT(NULLIF(BTRIM(a."city"), ''), 100),
         "zip" = LEFT(NULLIF(BTRIM(a."zip"), ''), 10),
         "has_insurance" = CASE LOWER(BTRIM(a."payload"->>'has_insurance'))
           WHEN 'yes' THEN true WHEN 'no' THEN false END
       FROM "applications" a
       WHERE a."driver_id" = d."id"`,
    );

    // A document now belongs to an application or to a driver (never both, never neither).
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "application_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD "driver_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_driver_kind_key" UNIQUE ("driver_id", "kind")`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_one_owner" CHECK (("application_id" IS NULL) <> ("driver_id" IS NULL) AND ("driver_id" IS NULL OR "origin" = 'admin'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ADD CONSTRAINT "FK_f6cc32b6a627e43b64630015437" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting would leave a driver's file with no owner, so it is refused while one exists (as D80's revert is).
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM "application_documents" WHERE "application_id" IS NULL`,
    )) as { count: number }[];
    if (count > 0) {
      throw new Error(
        `Cannot revert: ${count} document(s) belong to a driver added directly. Remove them first.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "FK_f6cc32b6a627e43b64630015437"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_one_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_driver_kind_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" DROP COLUMN "driver_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "application_documents" ALTER COLUMN "application_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "has_insurance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "date_of_birth"`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "zip"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "state"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "apt"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "street"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "middle_name"`);
  }
}
