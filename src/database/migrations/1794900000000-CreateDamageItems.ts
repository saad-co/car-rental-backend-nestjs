import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Module 3 chat 2, step 3 (D110): damage items, the damage staff found when they compared a check-out with its check-in.
 * One row per check-out photo that shows new damage; it can end in a ledger charge. Nothing existing is changed.
 */
export class CreateDamageItems1794900000000 implements MigrationInterface {
  name = "CreateDamageItems1794900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."damage_item_status" AS ENUM('new_during_rental', 'charged')`,
    );
    await queryRunner.query(
      `CREATE TABLE "damage_items" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "inspection_id" uuid NOT NULL,
         "photo_id" uuid NOT NULL,
         "description" character varying(500) NOT NULL,
         "status" "public"."damage_item_status" NOT NULL DEFAULT 'new_during_rental',
         "ledger_entry_id" uuid,
         "created_by_id" uuid,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_damage_items" PRIMARY KEY ("id"),
         CONSTRAINT "damage_items_description_not_blank" CHECK (length(btrim("description")) BETWEEN 1 AND 500),
         CONSTRAINT "damage_items_charged_iff_entry" CHECK (("status" = 'charged') = ("ledger_entry_id" IS NOT NULL))
       )`,
    );
    // One item per photo: marking the same photo twice (a double click) cannot make two.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "damage_items_photo_unique" ON "damage_items" ("photo_id")`,
    );
    // One charge per item, and one item per charge: a ledger entry can never be claimed by two damage items.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "damage_items_ledger_entry_unique" ON "damage_items" ("ledger_entry_id") WHERE "ledger_entry_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "damage_items_inspection_idx" ON "damage_items" ("inspection_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "damage_items" ADD CONSTRAINT "FK_damage_items_inspection" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "damage_items" ADD CONSTRAINT "FK_damage_items_photo" FOREIGN KEY ("photo_id") REFERENCES "inspection_photos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "damage_items" ADD CONSTRAINT "FK_damage_items_ledger_entry" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "damage_items" ADD CONSTRAINT "FK_damage_items_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "damage_items"`);
    await queryRunner.query(`DROP TYPE "public"."damage_item_status"`);
  }
}
