import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverLegacyId1791730208757 implements MigrationInterface {
  name = "AddDriverLegacyId1791730208757";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" ADD "legacy_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "UQ_ffbed07809b14f47cc5b6645f8b" UNIQUE ("legacy_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "UQ_ffbed07809b14f47cc5b6645f8b"`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "legacy_id"`);
  }
}
