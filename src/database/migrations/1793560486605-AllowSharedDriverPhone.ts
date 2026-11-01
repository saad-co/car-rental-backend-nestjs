import { MigrationInterface, QueryRunner } from "typeorm";

/** Several drivers may share a phone (B117): one person renting several cars. Existing rows are not touched. */
export class AllowSharedDriverPhone1793560486605 implements MigrationInterface {
  name = "AllowSharedDriverPhone1793560486605";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "UQ_b97a5a68c766d2d1ec25e6a85b2"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "UQ_b97a5a68c766d2d1ec25e6a85b2" UNIQUE ("phone")`,
    );
  }
}
