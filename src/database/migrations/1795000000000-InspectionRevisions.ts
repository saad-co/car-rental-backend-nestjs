import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Module 3 revisions (Abulkalam, 2026-11-17, D112):
 * - two new required shots, the left and right side mirrors, placed in the walk-around next to the front corner of their side
 *   (21 shots; the positions of the others move up);
 * - `inspection_photos.parent_shot_id`: a damage close-up now belongs to one required shot (up to 5 per shot). Old free-standing
 *   damage photos (no parent, 1 to 15) stay valid;
 * - `inspection_shot_answers`: the driver's "Is there any damage on ...?" answer, one per shot;
 * - a submitted inspection no longer needs a typed mileage and fuel level (both are read from the photos now).
 * Nothing is deleted: old inspections keep their photos, damage photos and readings.
 */
export class InspectionRevisions1795000000000 implements MigrationInterface {
  name = "InspectionRevisions1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Shots: positions are unique, so first move every shot out of the way, then give each its new place.
    await queryRunner.query(
      `UPDATE "inspection_shots" SET "position" = "position" + 100`,
    );
    await queryRunner.query(
      `INSERT INTO "inspection_shots" ("shot_id", "position", "title", "instruction") VALUES
       ('EXT_LEFT_MIRROR', 3, 'Left side mirror', 'Show the whole left side mirror: the glass and the housing.'),
       ('EXT_RIGHT_MIRROR', 8, 'Right side mirror', 'Show the whole right side mirror: the glass and the housing.')`,
    );
    await queryRunner.query(
      `UPDATE "inspection_shots" AS s SET "position" = v."position"
       FROM (VALUES
         ('EXT_DRIVER_SIDE', 1), ('EXT_LEFT_FRONT_CORNER', 2), ('TIRE_FRONT_LEFT', 4), ('EXT_FRONT', 5),
         ('EXT_WINDSHIELD', 6), ('EXT_RIGHT_FRONT_CORNER', 7), ('TIRE_FRONT_RIGHT', 9), ('EXT_PASSENGER_SIDE', 10),
         ('EXT_RIGHT_REAR_CORNER', 11), ('TIRE_REAR_RIGHT', 12), ('EXT_REAR', 13), ('TRUNK_INTERIOR', 14),
         ('TRUNK_SPARE_JACK', 15), ('EXT_LEFT_REAR_CORNER', 16), ('TIRE_REAR_LEFT', 17), ('INT_ODOMETER', 18),
         ('INT_FUEL', 19), ('INT_FRONT_SEATS', 20), ('INT_REAR_SEATS', 21)
       ) AS v("shot_id", "position")
       WHERE s."shot_id" = v."shot_id"`,
    );

    // Close-ups: a DAMAGE photo with a parent shot, numbered 1 to 5 within that shot.
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD "parent_shot_id" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD CONSTRAINT "FK_inspection_photos_parent_shot" FOREIGN KEY ("parent_shot_id") REFERENCES "inspection_shots"("shot_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" DROP CONSTRAINT "inspection_photos_position_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_position_range" CHECK (("parent_shot_id" IS NULL AND "position" BETWEEN 1 AND 15 AND ("shot_id" = 'DAMAGE' OR "position" = 1)) OR ("parent_shot_id" IS NOT NULL AND "shot_id" = 'DAMAGE' AND "position" BETWEEN 1 AND 5))`,
    );
    // One photo per slot. A slot is now (shot, parent, number); COALESCE because two NULL parents would otherwise never clash.
    await queryRunner.query(
      `DROP INDEX "public"."inspection_photos_slot_unique"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspection_photos_slot_unique" ON "inspection_photos" ("inspection_id", "shot_id", COALESCE("parent_shot_id", ''), "position")`,
    );

    await queryRunner.query(
      `CREATE TABLE "inspection_shot_answers" ("inspection_id" uuid NOT NULL, "shot_id" character varying(40) NOT NULL, "has_damage" boolean NOT NULL, "answered_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_inspection_shot_answers" PRIMARY KEY ("inspection_id", "shot_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_shot_answers" ADD CONSTRAINT "FK_inspection_shot_answers_inspection" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_shot_answers" ADD CONSTRAINT "FK_inspection_shot_answers_shot" FOREIGN KEY ("shot_id") REFERENCES "inspection_shots"("shot_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // Submitted = time and attestation; the readings are optional now.
    await queryRunner.query(
      `ALTER TABLE "inspections" DROP CONSTRAINT "inspections_submitted_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "inspections_submitted_shape" CHECK (("status" IN ('submitted', 'reviewed', 'flagged')) = ("submitted_at" IS NOT NULL) AND ("status" NOT IN ('submitted', 'reviewed', 'flagged') OR "attested_at" IS NOT NULL))`,
    );
  }

  /**
   * Undoes the change. Fails on purpose if new data depends on it: a submitted inspection without readings (the old CHECK), or
   * a close-up (the old slot index cannot hold two close-ups with the same number on different shots).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inspections" DROP CONSTRAINT "inspections_submitted_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspections" ADD CONSTRAINT "inspections_submitted_shape" CHECK (("status" IN ('submitted', 'reviewed', 'flagged')) = ("submitted_at" IS NOT NULL) AND ("status" NOT IN ('submitted', 'reviewed', 'flagged') OR ("attested_at" IS NOT NULL AND "odometer_miles" IS NOT NULL AND "fuel_level" IS NOT NULL)))`,
    );
    await queryRunner.query(`DROP TABLE "inspection_shot_answers"`);
    await queryRunner.query(
      `DROP INDEX "public"."inspection_photos_slot_unique"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" DROP CONSTRAINT "inspection_photos_position_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" DROP CONSTRAINT "FK_inspection_photos_parent_shot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" DROP COLUMN "parent_shot_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_position_range" CHECK ("position" BETWEEN 1 AND 15 AND ("shot_id" = 'DAMAGE' OR "position" = 1))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "inspection_photos_slot_unique" ON "inspection_photos" ("inspection_id", "shot_id", "position")`,
    );
    await queryRunner.query(
      `DELETE FROM "inspection_shots" WHERE "shot_id" IN ('EXT_LEFT_MIRROR', 'EXT_RIGHT_MIRROR')`,
    );
    await queryRunner.query(
      `UPDATE "inspection_shots" SET "position" = "position" + 100`,
    );
    await queryRunner.query(
      `UPDATE "inspection_shots" AS s SET "position" = v."position"
       FROM (VALUES
         ('EXT_DRIVER_SIDE', 1), ('EXT_LEFT_FRONT_CORNER', 2), ('TIRE_FRONT_LEFT', 3), ('EXT_FRONT', 4),
         ('EXT_WINDSHIELD', 5), ('EXT_RIGHT_FRONT_CORNER', 6), ('TIRE_FRONT_RIGHT', 7), ('EXT_PASSENGER_SIDE', 8),
         ('EXT_RIGHT_REAR_CORNER', 9), ('TIRE_REAR_RIGHT', 10), ('EXT_REAR', 11), ('TRUNK_INTERIOR', 12),
         ('TRUNK_SPARE_JACK', 13), ('EXT_LEFT_REAR_CORNER', 14), ('TIRE_REAR_LEFT', 15), ('INT_ODOMETER', 16),
         ('INT_FUEL', 17), ('INT_FRONT_SEATS', 18), ('INT_REAR_SEATS', 19)
       ) AS v("shot_id", "position")
       WHERE s."shot_id" = v."shot_id"`,
    );
  }
}
