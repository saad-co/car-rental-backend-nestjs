import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContractDetails1792562497442 implements MigrationInterface {
  name = "AddContractDetails1792562497442";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contract_companies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "address" character varying(300) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "contract_companies_name_address" UNIQUE ("name", "address"), CONSTRAINT "PK_ef82789285631c9530208514856" PRIMARY KEY ("id"))`,
    );
    // The fixed company list (MODULE2_SPEC.md section 1: the "Lessor:" lines of the client's sample contracts). Names and
    // addresses are copied as the spec has them; the name is also printed as the company's signature (D72).
    await queryRunner.query(
      `INSERT INTO "contract_companies" ("name", "address") VALUES
        ('Gonzo Enterprises Inc', '2515 Waukegan Rd, Suite 340, Bannockburn IL 60015'),
        ('Gonzo Enterprises Inc', '1107 S State St, Unit 11, Ukiah, CA 95482'),
        ('Evergreen Holdings LLC', '114 E Everett St, Ste 130, Dixon IL 61021'),
        ('Ashwood Holdings LLC', '114 E Everett St Ste 176, Dixon IL 61021'),
        ('Silver Pine Holdings LLC', '3902 W North Ave, Chicago IL 60647')`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD "company_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "vehicle_model" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "vehicle_vin" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "vehicle_plate" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "vehicle_plate_state" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "purchase_option_cents" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "lessee_address" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "license_number" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD "license_state" character varying(50)`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" ADD "date_of_birth" date`);
    await queryRunner.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_d5800fabd9afe7bbb166183879e" FOREIGN KEY ("company_id") REFERENCES "contract_companies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP CONSTRAINT "FK_d5800fabd9afe7bbb166183879e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "date_of_birth"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "license_state"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "license_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "lessee_address"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "purchase_option_cents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "vehicle_plate_state"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "vehicle_plate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "vehicle_vin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "contracts" DROP COLUMN "vehicle_model"`,
    );
    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "company_id"`);
    await queryRunner.query(`DROP TABLE "contract_companies"`);
  }
}
