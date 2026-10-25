import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDriverLeavingAndDeposit1792620000000 implements MigrationInterface {
  name = "AddDriverLeavingAndDeposit1792620000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "deposit_paid_cents" integer`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."driver_left_reason" AS ENUM('contract_ended', 'bad_driver', 'cooperative_returned_car')`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "left_reason" "public"."driver_left_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "left_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" ADD "left_by_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "sent_to_collections_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "sent_to_collections_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "drivers_deposit_amount_shape" CHECK ("deposit_paid_cents" IS NULL OR ("deposit_paid_at" IS NOT NULL AND "deposit_paid_cents" > 0))`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "drivers_collections_shape" CHECK ("sent_to_collections_at" IS NULL OR ("status" = 'inactive' AND "left_reason" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "drivers_left_shape" CHECK (("left_reason" IS NULL) = ("left_at" IS NULL) AND ("left_reason" IS NULL OR "status" = 'inactive'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_90a51dbdc806aa2878cf55280a2" FOREIGN KEY ("left_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_295e1dbc6f5c932a080df8032c0" FOREIGN KEY ("sent_to_collections_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_295e1dbc6f5c932a080df8032c0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_90a51dbdc806aa2878cf55280a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "drivers_left_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "drivers_collections_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "drivers_deposit_amount_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "sent_to_collections_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "sent_to_collections_at"`,
    );
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "left_by_id"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "left_at"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN "left_reason"`);
    await queryRunner.query(`DROP TYPE "public"."driver_left_reason"`);
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "deposit_paid_cents"`,
    );
  }
}
