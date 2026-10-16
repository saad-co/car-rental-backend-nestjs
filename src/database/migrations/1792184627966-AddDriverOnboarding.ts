import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Driver statuses and onboarding steps (D56): `onboarding` added (the new default), three step dates with the admin who
 * ticked each, and a CHECK that `active` needs all three.
 *
 * Edited after generation:
 * - The enum is rebuilt (rename, create, convert, drop) instead of `ALTER TYPE ... ADD VALUE`: Postgres refuses to use
 *   a value added in the same transaction ("unsafe use of new value"), and the new default uses it.
 * - Drivers already `active` (imported from the old system) get their three steps marked done at migration time with
 *   no admin ("done before this system"), BEFORE the CHECK is added, or the CHECK would reject the existing rows.
 * - `down` turns `onboarding` drivers back into `active` (the old type has no `onboarding`).
 */
export class AddDriverOnboarding1792184627966 implements MigrationInterface {
  name = "AddDriverOnboarding1792184627966";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "contract_signed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "contract_signed_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "deposit_paid_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "deposit_paid_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "vehicle_assigned_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD "vehicle_assigned_by_id" uuid`,
    );

    // Rebuild the enum with `onboarding` first (the order the entity declares).
    await queryRunner.query(
      `ALTER TYPE "public"."driver_status" RENAME TO "driver_status_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."driver_status" AS ENUM('onboarding', 'active', 'inactive')`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" TYPE "public"."driver_status" USING "status"::"text"::"public"."driver_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" SET DEFAULT 'onboarding'`,
    );
    await queryRunner.query(`DROP TYPE "public"."driver_status_old"`);

    // Drivers already active were onboarded before this system: their steps are done, by no admin.
    await queryRunner.query(
      `UPDATE "drivers" SET "contract_signed_at" = now(), "deposit_paid_at" = now(), "vehicle_assigned_at" = now()
       WHERE "status" = 'active'`,
    );

    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "drivers_active_is_onboarded" CHECK ("status" <> 'active' OR ("contract_signed_at" IS NOT NULL AND "deposit_paid_at" IS NOT NULL AND "vehicle_assigned_at" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_c8533c08fd1cf9ec1be1e26def4" FOREIGN KEY ("contract_signed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_de7ffbcda9550ca697fd5c38c81" FOREIGN KEY ("deposit_paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ADD CONSTRAINT "FK_90c4343e5f9b6ddad9074e452fb" FOREIGN KEY ("vehicle_assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_90c4343e5f9b6ddad9074e452fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_de7ffbcda9550ca697fd5c38c81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "FK_c8533c08fd1cf9ec1be1e26def4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP CONSTRAINT "drivers_active_is_onboarded"`,
    );
    // The old type has no `onboarding`; before D56 those drivers would have been active.
    await queryRunner.query(
      `UPDATE "drivers" SET "status" = 'active' WHERE "status" = 'onboarding'`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."driver_status_old" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" TYPE "public"."driver_status_old" USING "status"::"text"::"public"."driver_status_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."driver_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."driver_status_old" RENAME TO "driver_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "vehicle_assigned_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "vehicle_assigned_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "deposit_paid_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "deposit_paid_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "contract_signed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drivers" DROP COLUMN "contract_signed_at"`,
    );
  }
}
